"""Disposable simulation child for the loopback web service."""

import ctypes
import os
import signal
import sys
from pathlib import Path

if __name__ == "__main__" and sys.platform == "linux":
    # A stopped/restarted server must not leave an orphaned native simulation.
    ctypes.CDLL(None).prctl(1, signal.SIGKILL)
    if os.getppid() != int(sys.argv[3]):
        raise SystemExit("simulation supervisor is no longer present")

from pathway.geometry import validate_geometry
from pathway.replay import RunRequest, export_replay, save_replay
from pathway.runner import run_scenario


def main():
    root = Path(sys.argv[1])
    timeout = float(sys.argv[2])
    cancelled = False

    def cancel(*_):
        nonlocal cancelled
        cancelled = True

    signal.signal(signal.SIGTERM, cancel)
    request = RunRequest.model_validate_json((root / "request.json").read_text())
    scenario = request.scenario()
    validate_geometry(scenario)
    run_scenario(scenario, root / "raw", wall_timeout_s=timeout, cancel_requested=lambda: cancelled)
    save_replay(root / "result.json", export_replay(root / "raw", request))


if __name__ == "__main__":
    main()
