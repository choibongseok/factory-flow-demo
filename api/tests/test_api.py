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


def test_metrics_endpoint_reports_traffic_and_validates_params(app):
    with TestClient(app) as c:
        feed(c, "factory/line-a/gate-in-01/tag_read", event_id="m1", ts=now(), tag_id="T", sku="S", direction="out", qty=2)
        feed(c, "factory/line-a/gate-in-01/tag_read", event_id="m1", ts=now(), tag_id="T", sku="S", direction="out", qty=2)
        body = c.get("/api/metrics", params={"seconds": 60, "step": 5}).json()
        assert body["step"] == 5 and body["window_seconds"] == 60
        assert body["summary"]["stored"] == 1 and body["summary"]["duplicates"] == 1
        assert body["summary"]["out"] == 2 and body["summary"]["dup_rate"] == 0.5
        assert c.get("/api/metrics", params={"line": "line-b"}).json()["summary"]["received"] == 0
        assert c.get("/api/metrics", params={"seconds": 1}).status_code == 422
        assert c.get("/api/metrics", params={"step": 0}).status_code == 422


def test_status_answers_immediately_and_reports_starting_without_data(app):
    with TestClient(app) as c:
        r = c.get("/api/status")
        body = r.json()
        assert r.headers["cache-control"] == "no-store"
        assert body["state"] == "starting"  # broker never connected, no events yet
        assert body["checks"]["mqtt"] == "pending" and body["checks"]["simulator"] == "pending"
        assert body["checks"]["ingest"]["last_event_age_s"] is None
        assert isinstance(body["uptime_s"], int) and body["version"]


def test_status_is_available_before_database_is_ready():
    from app.config import Settings
    from app.main import create_app

    slow = create_app(Settings(database_url="sqlite+aiosqlite://", mqtt_enabled=False, startup_wait_seconds=0))
    with TestClient(slow) as c:
        assert c.get("/api/status").status_code == 200  # never waits for DB or MQTT


def test_status_ready_after_broker_connected_and_events_flow(app):
    with TestClient(app) as c:
        c.app.state.tracker.checks.mqtt = "ok"
        feed(c, "factory/line-a/amr-01/status", event_id="s1", ts=now(), state="moving")
        body = c.get("/api/status").json()
        assert body["state"] == "ready" and body["checks"]["simulator"] == "running"
        assert body["checks"]["ingest"]["last_event_age_s"] < 5


def test_websocket_rejects_origin_not_in_cors_list():
    import pytest
    from starlette.websockets import WebSocketDisconnect

    from app.config import Settings
    from app.main import create_app

    app = create_app(Settings(database_url="sqlite+aiosqlite://", mqtt_enabled=False, startup_wait_seconds=5,
                              cors_origins="https://example.github.io"))
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws", headers={"origin": "https://evil.example"}):
                pass
        with c.websocket_connect("/ws", headers={"origin": "https://example.github.io"}) as ws:
            assert ws.receive_json()["kind"] == "snapshot"
