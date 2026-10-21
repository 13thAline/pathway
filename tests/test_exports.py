import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from pathway.fixtures import fixture
from pathway.runner import run_scenario

spec = importlib.util.spec_from_file_location(
    "audit_run", Path(__file__).parents[1] / "scripts" / "audit_run.py"
)
audit_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)


def test_independent_export_recalculation_and_tampering(tmp_path):
    output = tmp_path / "run"
    run_scenario(fixture("service", 6), output)
    assert audit_module.audit(output)["status"] == "passed"
    target = output / "zones.csv"
    original = target.read_text()
    target.write_text(original + "tampered")
    with pytest.raises(ValueError, match="hash mismatch"):
        audit_module.audit(output)
    target.write_text(original)
    lines = target.read_text().splitlines()
    cells = lines[1].split(",")
    cells[4] = "12345"
    lines[1] = ",".join(cells)
    target.write_text("\n".join(lines) + "\n")
    manifest = json.loads((output / "manifest.json").read_text())
    manifest["output_sha256"]["zones.csv"] = hashlib.sha256(target.read_bytes()).hexdigest()
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="metric mismatch"):
        audit_module.audit(output)


def test_pedpy_density_crosscheck(tmp_path):
    import pandas as pd

    pedpy = pytest.importorskip("pedpy")
    output = tmp_path / "pedpy"
    scenario = fixture("corridor", 8)
    result = run_scenario(scenario, output)
    assert result["status"] == "succeeded"
    trajectories = pd.read_csv(output / "trajectories.csv")
    trajectories["id"] = trajectories["visitor_id"].astype("category").cat.codes
    trajectories["frame"] = (
        (trajectories["time_s"] / scenario.sample_interval_s).round().astype(int)
    )
    trajectories = trajectories.rename(columns={"x_m": "x", "y_m": "y"})
    data = pedpy.TrajectoryData(
        trajectories[["id", "frame", "x", "y"]], frame_rate=1 / scenario.sample_interval_s
    )
    area = pedpy.MeasurementArea(scenario.zones[0].polygon)
    density = pedpy.compute_classic_density(traj_data=data, measurement_area=area)
    exported = pd.read_csv(output / "zones.csv")
    for _, row in density.iterrows():
        t = row["frame"] * scenario.sample_interval_s
        actual = exported.loc[(exported["time_s"] - t).abs() < 1e-8, "density_per_m2"]
        assert len(actual) == 1
        assert actual.iloc[0] == pytest.approx(row["density"])
