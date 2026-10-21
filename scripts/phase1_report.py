#!/usr/bin/env python3
"""Regenerate Phase 1 synthetic evidence, independent audits and a compact public archive."""

import argparse
import importlib.util
import json
import platform
import zipfile
from pathlib import Path

from pathway.fixtures import fixture
from pathway.output import write_json
from pathway.runner import run_scenario
from pathway.schema import Scenario

spec = importlib.util.spec_from_file_location("audit_run", Path(__file__).with_name("audit_run.py"))
audit_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    args.runs.mkdir(parents=True, exist_ok=False)
    args.evidence.mkdir(parents=True, exist_ok=True)
    cases = {}
    for name in ["corridor", "bottleneck", "crossing", "opposing", "service"]:
        cases[name] = fixture(name, 24 if name != "service" else 12)
    cases["empty"] = fixture(count=0)
    single = fixture(count=1).model_dump()
    single["origins"][0]["positions"] = [[1, 4]]
    single["demand"][0].update(end_s=0, speed_m_s=[1.2, 1.2])
    cases["single"] = Scenario.model_validate(single)
    cases["repeat_a"] = cases["repeat_b"] = fixture("bottleneck", 8)
    half = cases["repeat_a"].model_dump() | {"dt_s": 0.005}
    cases["half_dt"] = Scenario.model_validate(half)
    cases["timed_out"] = fixture(count=20)
    cases["cancelled"] = fixture(count=20)
    overflow = fixture("service", 30).model_dump()
    overflow["demand"][0].update(end_s=0)
    overflow["services"][0].update(positions=[[14, 4]], duration_s=[100, 100])
    overflow["horizon_s"] = 20
    cases["overflow"] = Scenario.model_validate(overflow)
    cases["bottleneck_500"] = Scenario.model_validate_json(
        Path("examples/fixtures/bottleneck_500.json").read_text()
    )
    results = {}
    for name, scenario in cases.items():
        options = {}
        if name == "timed_out":
            options["wall_timeout_s"] = 0
        elif name == "cancelled":
            checks = iter([False] * 25 + [True])
            options["cancel_requested"] = lambda: next(checks)
        result = run_scenario(scenario, args.runs / name, **options)
        expected = {
            "timed_out": "timed_out",
            "cancelled": "cancelled",
            "overflow": "horizon_reached",
        }.get(name, "succeeded")
        if result["status"] != expected:
            raise RuntimeError(
                f"{name}: expected {expected}, got {result['status']}: {result['error']}"
            )
        audit = audit_module.audit(args.runs / name)
        results[name] = {
            "status": result["status"],
            "population": result["population"],
            "clearance_s": result["all_person_clearance_s"],
            "wall_time_s": result["wall_time_s"],
            "peak_process_rss_kib_linux": result["peak_process_rss_kib_linux"],
            "scenario_sha256": result["scenario_sha256"],
            "demand_sha256": result["demand_sha256"],
            "output_sha256": result["output_sha256"],
            "audit": audit,
        }
        print(f"{name}: {result['status']}; audit passed", flush=True)
    equal_files = ["trajectories.csv", "ledger.csv", "events.jsonl", "visitors.json", "demand.json"]
    for filename in equal_files:
        if (args.runs / "repeat_a" / filename).read_bytes() != (
            args.runs / "repeat_b" / filename
        ).read_bytes():
            raise RuntimeError(f"repeatability failure: {filename}")
    delta = abs(results["half_dt"]["clearance_s"] - results["repeat_a"]["clearance_s"])
    if delta >= 0.5:
        raise RuntimeError(f"timestep sensitivity gate failed: {delta}")
    summary = {
        "date": "2026-10-21",
        "kind": "synthetic_software_verification_not_field_validation",
        "platform": platform.platform(),
        "environment": json.loads((args.runs / "bottleneck_500" / "manifest.json").read_text())[
            "environment"
        ],
        "cases": results,
        "repeatability": {"byte_identical_files": equal_files},
        "timestep_sensitivity": {
            "dt_s": [0.01, 0.005],
            "clearance_delta_s": delta,
            "gate_s": 0.5,
            "scope": "8-person bottleneck only",
        },
        "limitations": [
            "No empirical benchmark or Puja event validation.",
            "Memory is process lifetime peak across cases.",
            "500 visitors arrive across 600 s; runtime is not a saturated-crowd benchmark.",
        ],
    }
    write_json(args.evidence / "verification.json", summary)
    with zipfile.ZipFile(
        args.evidence / "synthetic-runs.zip", "w", zipfile.ZIP_DEFLATED
    ) as archive:
        for file in sorted(args.runs.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(args.runs))
    print(args.evidence / "verification.json")


if __name__ == "__main__":
    main()
