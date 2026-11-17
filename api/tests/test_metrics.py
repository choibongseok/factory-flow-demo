from app.metrics import MetricsStore, percentile


def store():
    return MetricsStore(retention_seconds=600, clock=lambda: 1000.0)


def test_percentile_nearest_rank():
    assert percentile([], 95) is None
    assert percentile([7], 50) == 7
    vals = list(range(1, 101))
    assert percentile(vals, 50) == 50 and percentile(vals, 95) == 95 and percentile(vals, 100) == 100
    assert percentile([3, 1, 2], 50) == 2  # input order does not matter


def test_bucket_boundary_one_second():
    m = store()
    m.record_stored("line-a", 5, at=100.999)
    m.record_stored("line-a", 5, at=101.0)
    s = m.snapshot(seconds=10, step=1, now=105)
    by_t = {r["t"]: r["stored"] for r in s["series"]}
    assert by_t[100] == 1 and by_t[101] == 1


def test_bucket_boundary_five_second_step():
    m = store()
    m.record_stored("line-a", 5, at=104.9)
    m.record_stored("line-a", 5, at=105.0)
    s = m.snapshot(seconds=20, step=5, now=110)
    by_t = {r["t"]: r["stored"] for r in s["series"]}
    assert by_t[100] == 1 and by_t[105] == 1


def test_duplicate_rate_and_received_total():
    m = store()
    for i in range(3):
        m.record_stored("line-a", 1, at=990 + i)
    m.record_duplicate("line-a", at=993)
    m.record_rejected(at=994)
    sm = m.snapshot(seconds=60, now=1000)["summary"]
    assert (sm["stored"], sm["duplicates"], sm["rejected"], sm["received"]) == (3, 1, 1, 5)
    assert sm["dup_rate"] == 0.2


def test_line_filter_excludes_other_lines_and_rejected():
    m = store()
    m.record_stored("line-a", 1, at=995)
    m.record_stored("line-b", 1, at=995)
    m.record_duplicate("line-b", at=996)
    m.record_rejected(at=996)
    a = m.snapshot(seconds=30, line="line-a", now=1000)["summary"]
    assert (a["stored"], a["duplicates"], a["rejected"]) == (1, 0, 0)
    assert m.snapshot(seconds=30, now=1000)["summary"]["received"] == 4


def test_summary_latency_percentiles_merge_all_buckets():
    m = store()
    for i, lat in enumerate(range(1, 101)):
        m.record_stored("line-a", float(lat), at=900 + i * 0.5)
    sm = m.snapshot(seconds=120, step=10, now=1000)["summary"]
    assert sm["p50"] == 50 and sm["p95"] == 95


def test_empty_buckets_have_null_latency_and_zero_counts():
    s = store().snapshot(seconds=10, now=1000)
    assert len(s["series"]) == 10
    assert all(r["received"] == 0 and r["p95"] is None for r in s["series"])
    assert s["summary"]["per_second"] == 0 and s["summary"]["p95"] is None


def test_tag_read_quantities_per_line():
    m = store()
    m.record_stored("line-a", 1, "in", 5, at=998)
    m.record_stored("line-a", 1, "out", 2, at=998)
    m.record_stored("line-b", 1, "in", 1, at=999)
    s = m.snapshot(seconds=5, now=1000)
    assert (s["summary"]["in"], s["summary"]["out"]) == (6, 2)
    flows = {}
    for r in s["series"]:
        for ln, f in r["lines"].items():
            flows[ln] = (flows.get(ln, (0, 0))[0] + f["in"], flows.get(ln, (0, 0))[1] + f["out"])
    assert flows == {"line-a": (5, 2), "line-b": (1, 0)}


def test_old_buckets_are_pruned_after_retention():
    clock = {"t": 1000.0}
    m = MetricsStore(retention_seconds=60, clock=lambda: clock["t"])
    m.record_stored("line-a", 1)
    clock["t"] = 1200.0
    m.record_stored("line-a", 1)
    assert len(m._sec) == 1


def test_per_second_uses_elapsed_span_not_window():
    m = store()
    for t in range(991, 1001):
        m.record_stored("line-a", 1, at=t)
    sm = m.snapshot(seconds=300, now=1000)["summary"]
    assert sm["per_second"] == 1.0  # 10 events over the 10 seconds since the first one


def test_series_latency_uses_a_five_second_moving_window():
    m = store()
    m.record_stored("line-a", 900, at=100)  # one spike
    for t in range(101, 111):
        m.record_stored("line-a", 10, at=t)
    by_t = {r["t"]: r["p95"] for r in m.snapshot(seconds=20, step=1, now=110)["series"]}
    assert by_t[100] == 900 and by_t[104] == 900   # the spike stays in the window for 5 s
    assert by_t[105] == 10                          # then drops out; no single-second needle
    assert by_t[99] is None                         # nothing yet before the first sample
