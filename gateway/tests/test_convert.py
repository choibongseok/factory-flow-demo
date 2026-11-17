import json
from datetime import datetime, timezone

from gateway.convert import ScanBridge

T = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)


def poll(b, seq=5, code="QR-000123", ok=True, running=True):
    return b.poll(seq, code, ok, running, now=T)


def test_scan_and_status_use_shared_topic_convention():
    msgs = poll(ScanBridge("line-a", "scanner-opcua-01"))
    assert [m.topic for m in msgs] == [
        "factory/line-a/scanner-opcua-01/scan",
        "factory/line-a/scanner-opcua-01/status",
    ]
    assert all(m.qos == 1 for m in msgs)


def test_scan_payload_carries_code_result_and_timestamp():
    scan = json.loads(poll(ScanBridge("line-a", "s1"), code="QR-777777")[0].payload)
    assert scan["code"] == "QR-777777" and scan["result"] == "ok"
    assert scan["ts"] == T.isoformat()


def test_event_id_is_derived_from_machine_sequence_number():
    a, b = poll(ScanBridge("line-a", "s1"), seq=5)
    assert json.loads(a.payload)["event_id"] == "opcua-s1-5"
    assert json.loads(b.payload)["event_id"] == "opcua-s1-status-5"


def test_failed_scan_maps_to_fail_and_stopped_machine_to_idle():
    scan, status = poll(ScanBridge("line-a", "s1"), ok=False, running=False)
    assert json.loads(scan.payload)["result"] == "fail"
    assert json.loads(status.payload)["state"] == "idle"


def test_same_sequence_number_is_not_published_twice():
    b = ScanBridge("line-a", "s1")
    assert len(poll(b, seq=5)) == 2
    assert poll(b, seq=5) == []
    assert len(poll(b, seq=6)) == 2


def test_initial_zero_sequence_publishes_nothing():
    assert poll(ScanBridge("line-a", "s1"), seq=0) == []


def test_restarted_bridge_republishes_same_event_id_so_api_can_drop_it():
    before = poll(ScanBridge("line-a", "s1"), seq=9)
    after = poll(ScanBridge("line-a", "s1"), seq=9)  # new process, same machine value
    assert [json.loads(m.payload)["event_id"] for m in before] == [json.loads(m.payload)["event_id"] for m in after]
