import json
from datetime import datetime, timedelta, timezone

from app import service


def b(**kw):
    return json.dumps(kw).encode()


def iso(offset=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=offset)).isoformat()


async def test_duplicate_event_id_is_ignored(pipeline):
    payload = b(event_id="dup-1", ts=iso(), x=1, y=1)
    assert await pipeline.handle("factory/line-a/amr-01/position", payload) is True
    assert await pipeline.handle("factory/line-a/amr-01/position", payload) is False
    assert pipeline.stats.stored == 1 and pipeline.stats.duplicates == 1
    async with pipeline.sf() as s:
        assert len(await service.list_events(s)) == 1


async def test_duplicate_tag_read_counts_once(pipeline):
    payload = b(event_id="t1", ts=iso(), tag_id="TAG1", sku="SKU-A", direction="in")
    for _ in range(3):
        await pipeline.handle("factory/line-a/gate-in-01/tag_read", payload)
    async with pipeline.sf() as s:
        inv = await service.inventory(s)
    assert inv["items"][0]["inbound"] == 1


async def test_duplicate_is_not_broadcast(pipeline):
    sent = []

    async def capture(m):
        sent.append(m)

    pipeline.hub.broadcast = capture
    payload = b(event_id="x", ts=iso(), state="idle")
    await pipeline.handle("factory/line-a/amr-01/status", payload)
    await pipeline.handle("factory/line-a/amr-01/status", payload)
    assert len(sent) == 1 and sent[0]["device"]["state"] == "idle"


async def test_rejected_messages_are_counted_not_raised(pipeline):
    assert await pipeline.handle("bad/topic", b(x=1)) is False
    assert await pipeline.handle("factory/a/b/position", b"nope") is False
    assert pipeline.stats.rejected == 2 and pipeline.stats.stored == 0


async def test_out_of_order_event_does_not_overwrite_newer_state(pipeline):
    await pipeline.handle("factory/line-a/amr-01/position", b(event_id="n", ts=iso(0), x=10, y=10))
    await pipeline.handle("factory/line-a/amr-01/position", b(event_id="o", ts=iso(-30), x=99, y=99))
    async with pipeline.sf() as s:
        dev = (await service.list_devices(s, None, 20))[0]
        assert (dev["x"], dev["y"]) == (10, 10)
        assert len(await service.list_events(s)) == 2  # old event is still logged


async def test_device_state_and_kind(pipeline):
    await pipeline.handle("factory/line-b/amr-02/status", b(event_id="s", ts=iso(), state="charging", battery=15))
    await pipeline.handle("factory/line-b/gate-in-01/tag_read", b(event_id="g", ts=iso(), tag_id="a", sku="S", direction="in"))
    await pipeline.handle("factory/line-b/scanner-01/scan", b(event_id="q", ts=iso(), code="QR-1"))
    async with pipeline.sf() as s:
        devs = {d["device"]: d for d in await service.list_devices(s, "line-b", 20)}
    assert devs["amr-02"]["state"] == "charging" and devs["amr-02"]["battery"] == 15
    assert devs["gate-in-01"]["kind"] == "rfid_gate" and devs["scanner-01"]["kind"] == "qr_scanner"
    assert all(d["online"] for d in devs.values())


async def test_inventory_aggregation_and_line_filter(pipeline):
    reads = [
        ("line-a", "SKU-A", "in", 1), ("line-a", "SKU-A", "in", 1), ("line-a", "SKU-A", "out", 1),
        ("line-a", "SKU-B", "in", 5), ("line-b", "SKU-A", "in", 1),
    ]
    for i, (line, sku, d, q) in enumerate(reads):
        await pipeline.handle(
            f"factory/{line}/gate-01/tag_read", b(event_id=f"r{i}", ts=iso(i), tag_id=f"T{i}", sku=sku, direction=d, qty=q)
        )
    async with pipeline.sf() as s:
        inv = await service.inventory(s)
        a = await service.inventory(s, "line-a")
    by = {i["sku"]: i for i in inv["items"]}
    assert by["SKU-A"] == {**by["SKU-A"], "inbound": 3, "outbound": 1, "on_hand": 2}
    assert inv["totals"] == {"inbound": 8, "outbound": 1, "on_hand": 7}
    assert a["totals"]["inbound"] == 7


async def test_gateway_style_event_ids_dedupe_across_restart(pipeline):
    """OPC-UA gateway derives event_id from the machine's sequence number; a re-read after restart is a duplicate."""
    topic = "factory/line-a/scanner-opcua-01/scan"
    first = b(event_id="opcua-scanner-opcua-01-5", ts=iso(), code="QR-000123", result="ok")
    again = b(event_id="opcua-scanner-opcua-01-5", ts=iso(1), code="QR-000123", result="ok")
    assert await pipeline.handle(topic, first) is True
    assert await pipeline.handle(topic, again) is False
    async with pipeline.sf() as s:
        assert len(await service.list_events(s, device="scanner-opcua-01")) == 1


async def test_pipeline_feeds_metrics_for_stored_duplicate_and_rejected(pipeline):
    payload = b(event_id="m1", ts=iso(-0.05), tag_id="T", sku="S", direction="in", qty=3)
    await pipeline.handle("factory/line-a/gate-in-01/tag_read", payload)
    await pipeline.handle("factory/line-a/gate-in-01/tag_read", payload)
    await pipeline.handle("factory/line-a/gate-in-01/tag_read", b"garbage")
    sm = pipeline.metrics.snapshot(seconds=10)["summary"]
    assert (sm["stored"], sm["duplicates"], sm["rejected"], sm["in"]) == (1, 1, 1, 3)
    assert sm["p95"] is not None and sm["p95"] >= 50  # event ts was 50 ms in the past


async def test_purge_removes_only_events_older_than_retention(pipeline):
    await pipeline.handle("factory/line-a/gate-in-01/tag_read", b(event_id="old", ts=iso(-3 * 3600), tag_id="T", sku="S", direction="in"))
    await pipeline.handle("factory/line-a/gate-in-01/tag_read", b(event_id="new", ts=iso(-60), tag_id="T", sku="S", direction="in"))
    removed = await service.purge_older_than(pipeline.sf, hours=1)
    assert removed == 1
    async with pipeline.sf() as s:
        assert [e["event_id"] for e in await service.list_events(s)] == ["new"]
        assert (await service.inventory(s))["totals"]["inbound"] == 1
