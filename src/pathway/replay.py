"""Bounded browser exports; display sampling never replaces analytical outputs."""

import csv
import json
from pathlib import Path
from typing import Literal

from pydantic import Field

from pathway.comparison import summarize_run
from pathway.puja import PujaSettings, Variant, puja_scenario
from pathway.schema import StrictModel, canonical_hash


class RunRequest(StrictModel):
    variant: Variant = "baseline"
    count: int = Field(default=500, ge=1, le=750, strict=True)
    seed: int = Field(default=0, ge=0, le=2**32 - 1, strict=True)
    settings: PujaSettings = Field(default_factory=PujaSettings)

    def scenario(self):
        return puja_scenario(self.variant, self.count, self.seed, self.settings)


def export_replay(directory, request: RunRequest, *, mode: Literal["saved", "fresh"] = "fresh"):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    scenario = json.loads((directory / "scenario.json").read_text())
    if canonical_hash(request.scenario()) != manifest["scenario_sha256"]:
        raise ValueError("replay request does not match recorded scenario")
    summary = summarize_run(directory)
    visitors = json.loads((directory / "demand.json").read_text())
    ids = sorted(v["id"] for v in visitors)
    index = {key: i for i, key in enumerate(ids)}
    states = {"walking": 0, "queued": 1, "serving": 2}
    frames = {}
    final = manifest["simulated_time_s"]
    with (directory / "trajectories.csv").open() as file:
        for row in csv.DictReader(file):
            t = float(row["time_s"])
            if abs(t % 2) > 1e-8 and abs(t - final) > 1e-8:
                continue
            frames.setdefault(t, []).append(
                [
                    index[row["visitor_id"]],
                    round(float(row["x_m"]), 3),
                    round(float(row["y_m"]), 3),
                    states[row["state"]],
                ]
            )
    # Include empty frames at start/clearance and preserve all ledger samples.
    frames.setdefault(0.0, [])
    frames.setdefault(final, [])
    with (directory / "ledger.csv").open() as file:
        ledger = [
            {k: float(v) if k == "time_s" else int(v) for k, v in row.items()}
            for row in csv.DictReader(file)
        ]
    with (directory / "zones.csv").open() as file:
        zones = [
            {
                "t": float(r["time_s"]),
                "id": r["zone_id"],
                "count": int(r["count"]),
                "density": float(r["density_per_m2"]),
                "speed": float(r["mean_speed_m_s"]) if r["mean_speed_m_s"] else None,
            }
            for r in csv.DictReader(file)
        ]
    payload = {
        "format": "pathway-replay-1",
        "mode": mode,
        "request": request.model_dump(mode="json"),
        "request_sha256": canonical_hash(request),
        "scenario": scenario,
        "manifest": manifest,
        "summary": summary,
        "display": {
            "sample_interval_s": 2,
            "position_precision_m": 0.001,
            "interpolation": "none; held recorded frame",
            "state_codes": states,
        },
        "visitor_ids": ids,
        "frames": [{"t": t, "people": people} for t, people in sorted(frames.items())],
        "ledger": ledger,
        "zone_samples": zones,
        "limitations": [
            "Synthetic inputs; no field calibration or operational approval.",
            "Replay positions are rounded and sampled for display only; metrics use raw outputs.",
            "A single run is not the ten-seed study or an uncertainty interval.",
            "Staggering changes arrival timing; off-site costs and adherence are not modelled.",
            "Crowded queue outcomes are numerically sensitive; no force or injury model.",
        ],
    }
    return {"sha256": canonical_hash(payload), "payload": payload}


def save_replay(path, value):
    """Compact deterministic envelope; use a rename to publish only sealed exports."""
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    payload = json.dumps(value["payload"], sort_keys=True, separators=(",", ":"), allow_nan=False)
    sealed = {"sha256": value["sha256"], "data": payload}
    temporary.write_text(json.dumps(sealed, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(path)


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "--variant", choices=["baseline", "second_exit", "staggered"], required=True
    )
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    request = RunRequest(variant=args.variant, count=args.count, seed=args.seed)
    save_replay(args.output, export_replay(args.directory, request, mode="saved"))
    print(args.output)


if __name__ == "__main__":
    main()
