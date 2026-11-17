"""Runs against the real stack: Mosquitto + FastAPI + PostgreSQL (docker compose, see scripts/test-integration.sh)."""
import json
import uuid

import httpx
from websockets.sync.client import connect

from conftest import API, publish, events, ts, wait_until


def test_tag_read_published_over_mqtt_is_stored_in_postgres_and_counted(line):
    publish(f"factory/{line}/gate-in-01/tag_read", {"event_id": uuid.uuid4().hex, "ts": ts(), "tag_id": "T1", "sku": "SKU-IT", "direction": "in", "qty": 4})
    wait_until(lambda: events(line, type="tag_read"))
    inv = httpx.get(f"{API}/api/inventory", params={"line": line}).json()
    assert inv["items"][0]["sku"] == "SKU-IT" and inv["items"][0]["inbound"] == 4
    dev = httpx.get(f"{API}/api/devices", params={"line": line}).json()
    assert dev[0]["kind"] == "rfid_gate"


def test_same_event_id_published_twice_is_stored_once(line):
    eid = uuid.uuid4().hex
    msg = {"event_id": eid, "ts": ts(), "tag_id": "T2", "sku": "SKU-DUP", "direction": "in", "qty": 3}
    publish(f"factory/{line}/gate-in-01/tag_read", msg, times=3)
    wait_until(lambda: events(line, type="tag_read"))
    import time; time.sleep(1.0)  # let the redeliveries arrive
    assert len(events(line, type="tag_read")) == 1
    assert httpx.get(f"{API}/api/inventory", params={"line": line}).json()["totals"]["inbound"] == 3


def test_websocket_pushes_a_new_event_to_connected_clients(line):
    with connect(API.replace("http", "ws") + "/ws") as ws:
        assert json.loads(ws.recv(timeout=5))["kind"] == "snapshot"
        publish(f"factory/{line}/amr-01/status", {"event_id": uuid.uuid4().hex, "ts": ts(), "state": "charging", "battery": 12})
        for _ in range(200):  # other traffic may interleave; wait for ours
            msg = json.loads(ws.recv(timeout=10))
            if msg["kind"] == "event" and msg["event"]["line"] == line:
                assert msg["device"]["state"] == "charging"
                return
        raise AssertionError("event not pushed")


def test_metrics_endpoint_counts_stored_and_duplicate_messages(line):
    before = httpx.get(f"{API}/api/metrics", params={"seconds": 60}).json()["summary"]
    eid = uuid.uuid4().hex
    publish(f"factory/{line}/scanner-01/scan", {"event_id": eid, "ts": ts(), "code": "QR-1", "result": "ok"}, times=2)
    def grew():
        s = httpx.get(f"{API}/api/metrics", params={"seconds": 60}).json()["summary"]
        return s["stored"] > before["stored"] and s["duplicates"] > before["duplicates"]
    wait_until(grew)
    mine = httpx.get(f"{API}/api/metrics", params={"seconds": 60, "line": line}).json()["summary"]
    assert mine["stored"] == 1 and mine["duplicates"] == 1 and mine["p95"] is not None


def test_malformed_message_is_rejected_and_counted_without_breaking_the_consumer(line):
    before = httpx.get(f"{API}/health").json()["rejected"]
    publish(f"factory/{line}/amr-01/position", b"not json at all")
    wait_until(lambda: httpx.get(f"{API}/health").json()["rejected"] > before)
    publish(f"factory/{line}/amr-01/position", {"event_id": uuid.uuid4().hex, "ts": ts(), "x": 1, "y": 2})
    wait_until(lambda: events(line, type="position"))  # the consumer is still alive


def test_status_endpoint_reports_db_and_mqtt_connected():
    s = httpx.get(f"{API}/api/status").json()
    assert s["checks"]["db"] == "ok" and s["checks"]["mqtt"] == "ok"
    assert s["state"] in ("starting", "ready")
