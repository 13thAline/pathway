import csv
import hashlib
import json

import pytest

from pathway.fixtures import fixture
from pathway.runner import run_scenario
from pathway.schema import Scenario


def changed(s, **updates):
    return Scenario.model_validate(s.model_dump() | updates)


def read_rows(path, name):
    with (path / f"{name}.csv").open() as file:
        return list(csv.DictReader(file))


def assert_ledger(path):
    for row in read_rows(path, "ledger"):
        assert sum(
            int(row[k]) for k in ["future", "waiting_outside", "active", "completed", "rejected"]
        ) == int(row["total"])
        assert int(row["scheduled_by_time"]) == (
            int(row["waiting_outside"])
            + int(row["active"])
            + int(row["completed"])
            + int(row["rejected"])
        )


def test_empty_and_single_person_free_travel(tmp_path):
    empty = run_scenario(fixture(count=0), tmp_path / "empty")
    assert empty["status"] == "succeeded"
    assert empty["population"]["total"] == 0
    base = fixture(count=1).model_dump()
    base["origins"][0]["positions"] = [[1, 4]]
    base["demand"][0].update(end_s=0, speed_m_s=[1.2, 1.2])
    result = run_scenario(Scenario.model_validate(base), tmp_path / "single")
    assert result["status"] == "succeeded"
    # Exit starts at x=22; arrival/completion decisions are quantized to dt.
    assert abs(result["all_person_clearance_s"] - 21 / 1.2) < 0.05
    assert result["line_crossings"]["departure"]["negative"] == 1
    assert_ledger(tmp_path / "single")


def test_blocked_arrivals_remain_outside_and_unfinished_are_censored(tmp_path):
    data = fixture(count=30).model_dump()
    data["origins"][0]["positions"] = [[1, 4]]
    data["demand"][0].update(end_s=0)
    data.update(horizon_s=1, sample_interval_s=0.1)
    result = run_scenario(Scenario.model_validate(data), tmp_path / "blocked")
    assert result["status"] == "horizon_reached"
    assert result["population"]["waiting_outside"] > 0
    assert result["population"]["rejected"] == 0
    assert result["censored_visitors"] == 30
    assert result["all_person_clearance_s"] is None
    assert result["completed_journey_time"]["mean_s"] is None
    visitors = json.loads((tmp_path / "blocked" / "visitors.json").read_text())
    assert any(v["outside_wait_s"] == 1 for v in visitors)
    assert_ledger(tmp_path / "blocked")


def test_future_arrivals_do_not_end_run_early(tmp_path):
    data = fixture(count=1).model_dump()
    data["demand"][0].update(start_s=5, end_s=5)
    result = run_scenario(Scenario.model_validate(data), tmp_path / "future")
    assert result["status"] == "succeeded"
    rows = read_rows(tmp_path / "future", "ledger")
    assert rows[0]["future"] == "1"
    assert result["simulated_time_s"] > 5


@pytest.mark.parametrize("name", ["bottleneck", "crossing", "opposing"])
def test_interactions_complete_and_outputs_are_hashed(tmp_path, name):
    output = tmp_path / name
    result = run_scenario(fixture(name, 16), output)
    assert result["status"] == "succeeded", result["error"]
    assert result["population"]["completed"] == 16
    assert_ledger(output)
    for name, digest in result["output_sha256"].items():
        assert hashlib.sha256((output / name).read_bytes()).hexdigest() == digest


def test_service_fifo_duration_and_serial_server(tmp_path):
    output = tmp_path / "service"
    result = run_scenario(fixture("service", 8), output)
    assert result["status"] == "succeeded", result["error"]
    visitors = json.loads((output / "visitors.json").read_text())
    demand = {v["id"]: v for v in json.loads((output / "demand.json").read_text())}
    events = [json.loads(line) for line in (output / "events.jsonl").read_text().splitlines()]
    joins = [e["visitor_id"] for e in events if e["kind"] == "queue_join"]
    starts = [e["visitor_id"] for e in events if e["kind"] == "service_start"]
    ends = [e["visitor_id"] for e in events if e["kind"] == "service_end"]
    assert joins == starts == ends
    visits = sorted((v["services"]["darshan"] for v in visitors), key=lambda s: s["start_s"])
    for previous, current in zip(visits, visits[1:]):
        assert current["start_s"] >= previous["end_s"]
    for v in visitors:
        s = v["services"]["darshan"]
        requested = demand[v["visitor_id"]]["service_s"]["darshan"]
        assert requested <= s["end_s"] - s["start_s"] + 1e-8 <= requested + 0.011
        assert v["completed_s"] > s["end_s"] >= s["start_s"] >= s["queued_s"]
    assert_ledger(output)


def test_repeatability_and_timestep_sensitivity(tmp_path):
    scenario = fixture("bottleneck", 8)
    a = run_scenario(scenario, tmp_path / "a")
    b = run_scenario(scenario, tmp_path / "b")
    for file in ["trajectories.csv", "ledger.csv", "events.jsonl", "demand.json", "visitors.json"]:
        assert (tmp_path / "a" / file).read_bytes() == (tmp_path / "b" / file).read_bytes()
    assert a["demand_sha256"] == b["demand_sha256"]
    half = run_scenario(changed(scenario, dt_s=0.005), tmp_path / "half")
    assert half["status"] == "succeeded"
    # A numerical stability gate for this fixture, not a field-accuracy tolerance.
    assert abs(half["all_person_clearance_s"] - a["all_person_clearance_s"]) < 0.5


def test_timeout_cancellation_and_no_overwrite(tmp_path):
    timeout = run_scenario(fixture(), tmp_path / "timeout", wall_timeout_s=0)
    assert timeout["status"] == "timed_out"
    assert timeout["all_person_clearance_s"] is None
    checks = iter([False] * 25 + [True])
    cancelled = run_scenario(
        fixture(), tmp_path / "cancelled", cancel_requested=lambda: next(checks)
    )
    assert cancelled["status"] == "cancelled"
    assert cancelled["simulated_time_s"] == 0.25
    assert_ledger(tmp_path / "timeout")
    assert_ledger(tmp_path / "cancelled")
    with pytest.raises(FileExistsError):
        run_scenario(fixture(), tmp_path / "timeout")


def test_runtime_failure_has_terminal_manifest(tmp_path, monkeypatch):
    import jupedsim

    def fail(_):
        raise RuntimeError("injected engine failure")

    monkeypatch.setattr(jupedsim.Simulation, "iterate", fail)
    result = run_scenario(fixture(), tmp_path / "failed")
    assert result["status"] == "failed"
    assert "injected engine failure" in result["error"]
    assert (tmp_path / "failed" / "manifest.json").exists()


def test_service_overflow_and_unfinished_service_are_preserved(tmp_path):
    data = fixture("service", 30).model_dump()
    data["demand"][0].update(end_s=0)
    data["services"][0].update(positions=[[14, 4]], duration_s=[100, 100])
    data["horizon_s"] = 20
    output = tmp_path / "overflow"
    result = run_scenario(Scenario.model_validate(data), output)
    assert result["status"] == "horizon_reached"
    assert result["population"]["serving"] == 1
    assert result["population"]["active"] > result["population"]["serving"]
    assert result["population"]["completed"] == 0
    assert result["censored_visitors"] == 30
    visitors = json.loads((output / "visitors.json").read_text())
    serving = [v for v in visitors if v["state"] == "serving"]
    assert len(serving) == 1
    assert "end_s" not in serving[0]["services"]["darshan"]
    assert_ledger(output)


def test_cancellation_reports_crossing_in_final_unsampled_step(tmp_path):
    data = fixture(count=1).model_dump()
    data["origins"][0]["positions"] = [[1, 4]]
    data["demand"][0].update(end_s=0, speed_m_s=[1.2, 1.2])
    data["lines"] = [{"id": "early", "points": [[1.29, 1], [1.29, 7]]}]
    checks = iter([False] * 25 + [True])
    result = run_scenario(
        Scenario.model_validate(data), tmp_path / "last_step", cancel_requested=lambda: next(checks)
    )
    assert result["status"] == "cancelled"
    assert result["line_crossings"]["early"]["negative"] == 1
    flow = read_rows(tmp_path / "last_step", "flow")
    assert flow[-1]["negative_crossings"] == "1"
    assert float(flow[-1]["time_s"]) == 0.25
