import importlib.util
import json
from pathlib import Path

import pytest

from pathway.study import run_study

spec = importlib.util.spec_from_file_location(
    "audit_study", Path(__file__).parents[1] / "scripts/audit_study.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_study_audit_and_aggregate_corruption(tmp_path):
    output = tmp_path / "study"
    run_study(output, counts=[6], seeds=[0])
    result = module.audit_study(output, deep=True)
    assert result["runs"] == 3
    assert result["pairs"] == 2
    assert result["visitor_pairs"] == 12
    assert result["status"] == "passed"
    path = output / "comparison.json"
    report = json.loads(path.read_text())
    report["aggregated"]["6"]["second_exit"]["metrics"]["restricted_mean_journey_s"]["mean"] += 5
    path.write_text(json.dumps(report))
    with pytest.raises(ValueError, match="metric mismatch"):
        module.audit_study(output)


@pytest.mark.parametrize("target", ["zone_summary", "zone_aggregate", "run_csv"])
def test_study_audit_rejects_corrupt_tradeoffs(tmp_path, target):
    output = tmp_path / "study"
    run_study(output, counts=[6], seeds=[0])
    if target == "run_csv":
        path = output / "runs.csv"
        path.write_text(path.read_text().replace("succeeded", "failed", 1))
    else:
        path = output / "comparison.json"
        report = json.loads(path.read_text())
        if target == "zone_summary":
            report["runs"][0]["summary"]["zones"]["service_queue"]["sampled_person_s"] += 10
        else:
            report["aggregated"]["6"]["second_exit"]["zones"]["service_queue"][
                "sampled_person_s_delta"
            ]["mean"] += 10
        path.write_text(json.dumps(report))
    with pytest.raises(ValueError, match="mismatch"):
        module.audit_study(output)
