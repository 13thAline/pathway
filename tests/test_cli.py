import json
import os
import signal
import subprocess
import sys
import time

from pathway.cli import main
from pathway.fixtures import fixture
from pathway.output import write_json


def test_cli_validate_errors_and_run(tmp_path, capsys):
    scenario = tmp_path / "corridor.json"
    assert main(["example", "corridor", "--count", "1", "--output", str(scenario)]) == 0
    assert main(["validate", str(scenario)]) == 0
    assert main(["run", str(scenario), "--output", str(tmp_path / "out")]) == 0
    scenario.write_text('{"schema_version": "wrong"}')
    assert main(["validate", str(scenario)]) == 2
    assert "pathway:" in capsys.readouterr().err


def test_real_cli_sigint_preserves_partial_result(tmp_path):
    scenario = tmp_path / "crowd.json"
    write_json(scenario, fixture("bottleneck", 500).model_dump(mode="json"))
    output = tmp_path / "interrupted"
    process = subprocess.Popen(
        [sys.executable, "-m", "pathway.cli", "run", str(scenario), "--output", str(output)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 10
        # An event buffer flushed by the real runner proves it has entered the run loop.
        while time.monotonic() < deadline:
            events = output / "events.jsonl"
            if events.exists() and events.stat().st_size > 0:
                break
            if process.poll() is not None:
                raise AssertionError(process.communicate())
            time.sleep(0.02)
        else:
            raise AssertionError("runner did not produce live events")
        os.kill(process.pid, signal.SIGINT)
        stdout, stderr = process.communicate(timeout=10)
        assert process.returncode == 1, (stdout, stderr)
        result = json.loads((output / "manifest.json").read_text())
        assert result["status"] == "cancelled"
        assert result["population"]["active"] > 0
        assert result["censored_visitors"] > 0
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
