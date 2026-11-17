import json
from datetime import datetime, timezone

import pytest

from app.normalize import derive_event_id, parse_message, parse_ts


def msg(**kw):
    return json.dumps(kw).encode()


def test_position_ok():
    ev = parse_message("factory/line-a/amr-01/position", msg(event_id="e1", ts="2026-01-01T00:00:00Z", x=1, y=2.5))
    assert (ev.line, ev.device, ev.type, ev.event_id) == ("line-a", "amr-01", "position", "e1")
    assert ev.data == {"x": 1.0, "y": 2.5}
    assert ev.ts == datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_tag_read_ok():
    ev = parse_message("factory/line-a/gate-in-01/tag_read", msg(event_id="e", tag_id="t", sku="SKU-1", direction="in"))
    assert ev.data["qty"] == 1 and ev.data["direction"] == "in"


@pytest.mark.parametrize(
    "topic",
    ["factory/line-a/amr-01", "other/a/b/position", "factory//b/position", "factory/a/b/position/extra"],
)
def test_bad_topic(topic):
    with pytest.raises(ValueError, match="bad topic"):
        parse_message(topic, msg(x=1, y=1))


def test_unknown_type():
    with pytest.raises(ValueError, match="unsupported"):
        parse_message("factory/a/b/explode", msg(x=1))


@pytest.mark.parametrize("payload", [b"not json", b"[1,2]", b"\xff\xfe"])
def test_bad_payload(payload):
    with pytest.raises(ValueError):
        parse_message("factory/a/b/position", payload)


def test_schema_violation():
    with pytest.raises(ValueError, match="invalid tag_read"):
        parse_message("factory/a/g/tag_read", msg(tag_id="t", sku="s", direction="sideways"))


def test_event_id_too_long():
    with pytest.raises(ValueError, match="event_id"):
        parse_message("factory/a/b/position", msg(event_id="x" * 65, x=1, y=1))


def test_derived_id_is_deterministic_and_content_sensitive():
    a = parse_message("factory/a/b/position", msg(x=1, y=2))
    b = parse_message("factory/a/b/position", msg(y=2, x=1))
    c = parse_message("factory/a/b/position", msg(x=1, y=3))
    assert a.event_id == b.event_id != c.event_id
    assert a.event_id == derive_event_id("factory/a/b/position", {"x": 1, "y": 2})


def test_parse_ts_variants():
    now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    assert parse_ts(0, now) == datetime(1970, 1, 1, tzinfo=timezone.utc)
    assert parse_ts("garbage", now) == now
    assert parse_ts(None, now) == now
    assert parse_ts("2026-01-01T09:00:00+09:00").hour == 0
