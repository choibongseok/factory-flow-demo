import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient


def now():
    return datetime.now(timezone.utc).isoformat()


def feed(client, topic, **body):
    return client.portal.call(client.app.state.pipeline.handle, topic, json.dumps(body).encode())


def test_rest_endpoints(app):
    with TestClient(app) as c:
        feed(c, "factory/line-a/amr-01/position", event_id="1", ts=now(), x=3, y=4)
        feed(c, "factory/line-a/amr-01/status", event_id="2", ts=now(), state="moving", battery=80)
        feed(c, "factory/line-a/gate-in-01/tag_read", event_id="3", ts=now(), tag_id="T", sku="SKU-A", direction="in")
        feed(c, "factory/line-a/gate-in-01/tag_read", event_id="3", ts=now(), tag_id="T", sku="SKU-A", direction="in")

        devs = c.get("/api/devices").json()
        assert {d["device"] for d in devs} == {"amr-01", "gate-in-01"}
        amr = next(d for d in devs if d["device"] == "amr-01")
        assert (amr["x"], amr["y"], amr["state"], amr["online"]) == (3, 4, "moving", True)

        assert len(c.get("/api/events").json()) == 3
        assert [e["type"] for e in c.get("/api/events", params={"type": "tag_read"}).json()] == ["tag_read"]
        assert len(c.get("/api/events", params={"device": "amr-01", "limit": 1}).json()) == 1
        assert c.get("/api/events", params={"limit": 0}).status_code == 422

        inv = c.get("/api/inventory").json()
        assert inv["totals"] == {"inbound": 1, "outbound": 0, "on_hand": 1}
        assert c.get("/api/movements").json()[0]["sku"] == "SKU-A"

        h = c.get("/health").json()
        assert (h["stored"], h["duplicates"]) == (3, 1)


def test_websocket_snapshot_then_live_event(app):
    with TestClient(app) as c:
        feed(c, "factory/line-a/amr-01/position", event_id="a", ts=now(), x=1, y=1)
        with c.websocket_connect("/ws") as ws:
            snap = ws.receive_json()
            assert snap["kind"] == "snapshot" and snap["devices"][0]["device"] == "amr-01"
            feed(c, "factory/line-a/amr-01/position", event_id="b", ts=now(), x=7, y=8)
            msg = ws.receive_json()
            assert msg["kind"] == "event"
            assert msg["event"]["event_id"] == "b" and msg["device"]["x"] == 7
            feed(c, "factory/line-a/amr-01/position", event_id="b", ts=now(), x=7, y=8)  # duplicate: no push
            feed(c, "factory/line-a/amr-01/position", event_id="c", ts=now(), x=9, y=9)
            assert ws.receive_json()["event"]["event_id"] == "c"
