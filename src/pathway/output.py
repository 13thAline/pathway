"""Stream raw evidence to disk and seal it with content hashes."""

import csv
import hashlib
import json
import platform
import subprocess
from importlib.metadata import version
from pathlib import Path


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


class Output:
    fields = {
        "trajectories": [
            "time_s",
            "visitor_id",
            "x_m",
            "y_m",
            "speed_m_s",
            "state",
            "from_x_m",
            "from_y_m",
            "speed_window_s",
        ],
        "ledger": [
            "time_s",
            "total",
            "future",
            "waiting_outside",
            "active",
            "completed",
            "rejected",
            "scheduled_by_time",
            "queued",
            "serving",
        ],
        "zones": [
            "time_s",
            "zone_id",
            "count",
            "usable_area_m2",
            "density_per_m2",
            "mean_speed_m_s",
        ],
        "flow": [
            "time_s",
            "line_id",
            "window_s",
            "positive_crossings",
            "negative_crossings",
            "positive_per_s",
            "negative_per_s",
        ],
    }

    def __init__(self, directory):
        self.path = Path(directory)
        self.path.mkdir(parents=True, exist_ok=False)
        self.files = {}
        self.writers = {}
        for name, fields in self.fields.items():
            file = (self.path / f"{name}.csv").open("w", newline="")
            self.files[name] = file
            writer = csv.DictWriter(file, fieldnames=fields)
            writer.writeheader()
            self.writers[name] = writer
        self.events = (self.path / "events.jsonl").open("w")
        self.crossings = (self.path / "crossings.jsonl").open("w")

    def row(self, name, value):
        self.writers[name].writerow(value)

    def event(self, kind, now, visitor_id=None, **details):
        self.events.write(
            json.dumps(
                {"kind": kind, "time_s": now, "visitor_id": visitor_id, **details}, allow_nan=False
            )
            + "\n"
        )

    def crossing(self, value):
        self.crossings.write(json.dumps(value, allow_nan=False) + "\n")

    def close(self):
        for file in [*self.files.values(), self.events, self.crossings]:
            file.close()

    def hashes(self):
        hashes = {}
        for path in sorted(self.path.iterdir()):
            if path.name == "manifest.json" or not path.is_file():
                continue
            with path.open("rb") as file:
                hashes[path.name] = hashlib.file_digest(file, "sha256").hexdigest()
        return hashes


def environment():
    root = Path(__file__).resolve().parents[2]
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, stderr=subprocess.DEVNULL, text=True
        ).strip()
        dirty = bool(
            subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
        )
    except (OSError, subprocess.CalledProcessError):
        commit, dirty = None, None
    source = hashlib.sha256()
    for path in sorted((root / "src" / "pathway").glob("*.py")):
        source.update(path.name.encode() + b"\0" + path.read_bytes())
    lock = root / "uv.lock"
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "code_revision": commit,
        "working_tree_dirty": dirty,
        "kernel_source_sha256": source.hexdigest(),
        "lock_sha256": hashlib.sha256(lock.read_bytes()).hexdigest() if lock.exists() else None,
        "packages": {
            name: version(name)
            for name in ("pathway-crowd", "jupedsim", "pydantic", "numpy", "shapely")
        },
    }
