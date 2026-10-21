import json
import os
import signal
import subprocess
import sys
import time

import pytest

from pathway.cli import main
from pathway.study import run_study


def test_study_resume_exports_and_mismatch_rejection(tmp_path):
    output = tmp_path / "study"
    report = run_study(output, counts=[6], seeds=[7])
    assert report["requested_runs"] == 3
    assert report["execution_failures"] == 0
    assert report["aggregated"]["6"]["second_exit"]["valid_pairs"] == 1
    assert (output / "runs.csv").exists()
    assert (output / "zone-pairs.csv").exists()
    assert (output / "visitor-pairs.csv").exists()
    before = {str(p): p.read_bytes() for p in (output / "runs").rglob("manifest.json")}
    resumed = run_study(output, counts=[6], seeds=[7], resume=True)
    assert all(r["reused"] for r in resumed["runs"])
    assert before == {str(p): p.read_bytes() for p in (output / "runs").rglob("manifest.json")}
    with pytest.raises(ValueError, match="differ"):
        run_study(output, counts=[6], seeds=[8], resume=True)
    corrupt = next((output / "runs").rglob("zones.csv"))
    corrupt.write_text(corrupt.read_text() + "corrupt")
    with pytest.raises(ValueError, match="hash mismatch"):
        run_study(output, counts=[6], seeds=[7], resume=True)


def test_parallel_runs_and_pairing(tmp_path):
    report = run_study(tmp_path / "parallel", counts=[6], seeds=[4], workers=2)
    assert report["requested_runs"] == 3
    assert report["execution_failures"] == 0
    assert [r["key"][2] for r in report["runs"]] == ["baseline", "second_exit", "staggered"]
    run_study(tmp_path / "serial", counts=[6], seeds=[4], workers=1)
    for variant in ["baseline", "second_exit", "staggered"]:
        name = f"n6_s4_{variant}"
        for file in ["trajectories.csv", "events.jsonl", "ledger.csv", "visitors.json"]:
            assert (tmp_path / "parallel/runs" / name / file).read_bytes() == (
                tmp_path / "serial/runs" / name / file
            ).read_bytes()


def test_failed_runs_not_silently_averaged(tmp_path):
    report = run_study(tmp_path / "timeout", counts=[6], seeds=[0], wall_timeout_s=0)
    assert report["execution_failures"] == 3
    pairs = report["aggregated"]["6"]["second_exit"]
    assert pairs["valid_pairs"] == 0 and pairs["execution_incomplete"] == 1


def test_cli_event_and_comparison(tmp_path):
    file = tmp_path / "event.json"
    assert main(["puja", "--count", "6", "--variant", "second_exit", "--output", str(file)]) == 0
    assert json.loads(file.read_text())["id"] == "puja_second_exit_6"
    assert main(["validate", str(file)]) == 0
    assert (
        main(
            [
                "compare",
                "--counts",
                "6",
                "--seeds",
                "0",
                "--wall-timeout",
                "0",
                "--output",
                str(tmp_path / "timed"),
            ]
        )
        == 1
    )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"counts": []},
        {"seeds": []},
        {"counts": [6, 6]},
        {"workers": True},
        {"slow_speed_m_s": float("nan")},
    ],
)
def test_invalid_study_controls(tmp_path, kwargs):
    with pytest.raises(ValueError):
        run_study(tmp_path / "bad", **kwargs)


def test_parallel_study_interrupt_stops_pending_work(tmp_path):
    output = tmp_path / "cancelled"
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "pathway.cli",
            "compare",
            "--counts",
            "750",
            "--seeds",
            "1",
            "2",
            "--workers",
            "2",
            "--output",
            str(output),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            events = list(output.glob("runs/*/events.jsonl"))
            if any(p.stat().st_size > 0 for p in events):
                break
            if process.poll() is not None:
                raise AssertionError(process.communicate())
            time.sleep(0.02)
        else:
            raise AssertionError("no live study event output")
        os.kill(process.pid, signal.SIGINT)
        stdout, stderr = process.communicate(timeout=15)
        assert process.returncode == 130, (stdout, stderr)
        manifests = [json.loads(p.read_text()) for p in output.glob("runs/*/manifest.json")]
        assert manifests and any(r["status"] == "cancelled" for r in manifests)
        assert len(manifests) < 6
        assert not (output / "comparison.json").exists()
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
