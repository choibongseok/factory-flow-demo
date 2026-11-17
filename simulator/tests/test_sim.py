import json

from sim.devices import MAP_H, MAP_W, build_fleet
from sim.events import make_message


def test_envelope_and_qos():
    m = make_message("line-a", "amr-01", "position", {"x": 1, "y": 2})
    body = json.loads(m.payload)
    assert m.topic == "factory/line-a/amr-01/position" and m.qos == 0
    assert len(body["event_id"]) == 32 and "ts" in body
    assert make_message("l", "d", "tag_read", {}).qos == 1


def test_event_ids_unique():
    ids = {json.loads(make_message("l", "d", "scan", {}).payload)["event_id"] for _ in range(500)}
    assert len(ids) == 500


def test_fleet_stays_on_map_and_emits_all_event_types():
    fleet = build_fleet(2, 2, seed=1)
    seen = set()
    for _ in range(600):
        for m in fleet.tick(1.0):
            body = json.loads(m.payload)
            seen.add(m.topic.rsplit("/", 1)[1])
            if "x" in body:
                assert 0 <= body["x"] <= MAP_W and 0 <= body["y"] <= MAP_H
    assert seen == {"position", "status", "tag_read", "scan"}


def test_seed_is_reproducible():
    def run():
        f = build_fleet(1, 1, seed=7)
        return [json.loads(m.payload).get("x") for _ in range(50) for m in f.tick(1.0) if m.topic.endswith("position")]
    assert run() == run()
