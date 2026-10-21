import copy
import json

import pytest

from pathway.comparison import aggregate_pairs, pair_runs, summarize_run, summarize_zone
from pathway.puja import puja_scenario
from pathway.runner import run_scenario


def summary(unfinished=0):
    return {
        "identity_sha256": "same",
        "horizon_s": 1200,
        "measurement": {"interval": 1},
        "usable_for_comparison": True,
        "all_arrivals_observed": True,
        "status": "succeeded",
        "metrics": {
            "unfinished_count": unfinished,
            "completed_journey_p95_s": 200,
            "restricted_mean_journey_s": 100,
        },
        "zones": {
            "upstream": {"area_m2": 10, "sampled_person_s": 50},
            "downstream": {"area_m2": 10, "sampled_person_s": 10},
        },
    }


def test_pairing_exposes_local_harm_and_changed_area():
    baseline, alternate = summary(), summary()
    alternate["metrics"]["restricted_mean_journey_s"] = 80
    alternate["zones"]["upstream"]["sampled_person_s"] = 20
    alternate["zones"]["downstream"].update(sampled_person_s=40, area_m2=12)
    result = pair_runs(baseline, alternate)
    assert result["deltas"]["restricted_mean_journey_s"] == -20
    assert result["worsened_zone_exposure"] == ["downstream"]
    assert result["zones"]["downstream"]["area_changed"]
    assert result["zones"]["downstream"]["deltas"]["sampled_person_s"] == 30


def test_censoring_prevents_completed_only_tail_ranking():
    baseline, alternate = summary(), summary(unfinished=40)
    alternate["status"] = "horizon_reached"
    alternate["metrics"]["completed_journey_p95_s"] = 5
    result = pair_runs(baseline, alternate)
    assert result["deltas"]["completed_journey_p95_s"] is None
    assert result["deltas"]["unfinished_count"] == 40
    assert result["horizon_limited"]


def test_aggregate_keeps_failed_and_undefined_pairs_visible():
    a = pair_runs(summary(), summary())
    b = copy.deepcopy(a)
    b["deltas"]["restricted_mean_journey_s"] = 20
    b["deltas"]["completed_journey_p95_s"] = None
    failed = {"status": "execution_incomplete", "deltas": {}, "zones": {}}
    report = aggregate_pairs([a, b, failed])
    assert report["total_pairs"] == 3
    assert report["valid_pairs"] == 2
    assert report["execution_incomplete"] == 1
    metric = report["metrics"]["restricted_mean_journey_s"]
    assert metric["mean"] == 10
    assert metric["positive"] == 1 and metric["equal"] == 1
    assert report["metrics"]["completed_journey_p95_s"]["undefined_pairs"] == 1


def test_unmatched_horizons_or_measurements_rejected():
    baseline, alternate = summary(), summary()
    alternate["horizon_s"] = 600
    with pytest.raises(ValueError, match="horizon"):
        pair_runs(baseline, alternate)
    alternate = summary()
    alternate["measurement"] = {"interval": 2}
    with pytest.raises(ValueError, match="measurement"):
        pair_runs(baseline, alternate)


def test_sampled_exposure_and_duration_match_hand_calculation():
    rows = [
        {
            "time_s": "0",
            "count": "0",
            "usable_area_m2": "4.5",
            "density_per_m2": "0",
            "mean_speed_m_s": "",
        },
        {
            "time_s": "2",
            "count": "2",
            "usable_area_m2": "4.5",
            "density_per_m2": str(2 / 4.5),
            "mean_speed_m_s": "0.1",
        },
        {
            "time_s": "5",
            "count": "0",
            "usable_area_m2": "4.5",
            "density_per_m2": "0",
            "mean_speed_m_s": "",
        },
    ]
    result = summarize_zone(rows, 0.3)
    assert result["sampled_person_s"] == 5
    assert result["sampled_occupied_s"] == 3
    assert result["sampled_slow_s"] == 3
    assert result["peak_count"] == 2


def test_real_output_summary_and_reserved_corridor(tmp_path):
    path = tmp_path / "run"
    run_scenario(puja_scenario("baseline", 6), path)
    result = summarize_run(path)
    visitors = json.loads((path / "visitors.json").read_text())
    expected = sum(v["completed_s"] - v["arrival_s"] for v in visitors) / 6
    assert result["metrics"]["restricted_mean_journey_s"] == pytest.approx(expected)
    assert result["metrics"]["unfinished_count"] == 0
    assert result["completion_by_assigned_exit"] == {"main": 6}
    assert result["reserved_strip_connected_for_model_radius"]
    assert result["zones"]["medical_access"]["peak_count"] == 0
    assert result["audit"]["status"] == "passed"
