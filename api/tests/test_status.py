from app.status import StatusTracker


def tracker():
    t = {"now": 100.0}
    return StatusTracker(clock=lambda: t["now"]), t


def test_all_pending_is_starting():
    tr, _ = tracker()
    assert tr.snapshot()["state"] == "starting"


def test_db_ok_mqtt_pending_is_starting():
    tr, _ = tracker()
    tr.checks.db = "ok"
    assert tr.snapshot()["state"] == "starting"


def test_any_error_is_degraded_even_if_others_pending():
    tr, _ = tracker()
    tr.checks.mqtt = "error"
    snap = tr.snapshot()
    assert snap["state"] == "degraded" and snap["checks"]["mqtt"] == "error"


def test_ready_needs_db_mqtt_and_a_recent_event():
    tr, t = tracker()
    tr.checks.db = tr.checks.mqtt = "ok"
    assert tr.snapshot()["state"] == "starting"  # simulator still pending: no event yet
    tr.event_seen()
    t["now"] += 3
    snap = tr.snapshot(events_per_s=38.04)
    assert snap["state"] == "ready" and snap["checks"]["simulator"] == "running"
    assert snap["checks"]["ingest"] == {"last_event_age_s": 3.0, "events_per_s": 38.0}


def test_stale_events_mean_simulator_stopped_and_degraded():
    tr, t = tracker()
    tr.checks.db = tr.checks.mqtt = "ok"
    tr.event_seen()
    t["now"] += 11
    snap = tr.snapshot()
    assert snap["checks"]["simulator"] == "stopped" and snap["state"] == "degraded"


def test_uptime_counts_seconds_since_start():
    tr, t = tracker()
    t["now"] += 12.9
    assert tr.snapshot()["uptime_s"] == 12
