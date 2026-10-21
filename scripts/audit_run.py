#!/usr/bin/env python3
"""Independently recalculate output accounting/metrics; do not call kernel metric helpers."""

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon


def rows(directory, name):
    with (directory / f"{name}.csv").open() as file:
        return list(csv.DictReader(file))


def close(a, b):
    if not math.isclose(float(a), float(b), rel_tol=1e-8, abs_tol=1e-8):
        raise ValueError(f"metric mismatch: {a} != {b}")


def audit(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    required = {
        "scenario.json",
        "demand.json",
        "visitors.json",
        "trajectories.csv",
        "ledger.csv",
        "zones.csv",
        "flow.csv",
        "events.jsonl",
        "crossings.jsonl",
    }
    if set(manifest["output_sha256"]) != required:
        raise ValueError("missing or unexpected output file in manifest")
    for file, digest in manifest["output_sha256"].items():
        with (directory / file).open("rb") as handle:
            if hashlib.file_digest(handle, "sha256").hexdigest() != digest:
                raise ValueError(f"hash mismatch: {file}")
    scenario = json.loads((directory / "scenario.json").read_text())
    demand = json.loads((directory / "demand.json").read_text())
    visitors = json.loads((directory / "visitors.json").read_text())
    for value, key in [(scenario, "scenario_sha256"), (demand, "demand_sha256")]:
        digest = hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()
        if digest != manifest[key]:
            raise ValueError(f"input hash mismatch: {key}")
    events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
    crossings = [
        json.loads(line) for line in (directory / "crossings.jsonl").read_text().splitlines()
    ]
    geometry = Polygon(scenario["geometry"]["boundary"], scenario["geometry"]["obstacles"])
    zones = {z["id"]: Polygon(z["polygon"]).intersection(geometry) for z in scenario["zones"]}
    lines = {line["id"]: line["points"] for line in scenario["lines"]}
    trajectory = defaultdict(list)
    for row in rows(directory, "trajectories"):
        point = (float(row["x_m"]), float(row["y_m"]))
        if not all(math.isfinite(x) for x in point) or not geometry.covers(Point(point)):
            raise ValueError("nonfinite or out-of-domain trajectory")
        if row["speed_m_s"] != "":
            previous = (float(row["from_x_m"]), float(row["from_y_m"]))
            close(row["speed_m_s"], math.dist(previous, point) / float(row["speed_window_s"]))
        trajectory[float(row["time_s"])].append(row)
    admissions = {e["visitor_id"]: e["time_s"] for e in events if e["kind"] == "admission"}
    completions = {e["visitor_id"]: e["time_s"] for e in events if e["kind"] == "completion"}
    if len(admissions) != sum(e["kind"] == "admission" for e in events):
        raise ValueError("duplicate admission")
    if len(completions) != sum(e["kind"] == "completion" for e in events):
        raise ValueError("duplicate completion")
    ledger = rows(directory, "ledger")
    for row in ledger:
        t = float(row["time_s"])
        future = sum(v["arrival_s"] > t + 1e-9 for v in demand)
        completed = sum(end <= t + 1e-9 for end in completions.values())
        admitted = sum(start <= t + 1e-9 for start in admissions.values())
        active = admitted - completed
        outside = len(demand) - future - admitted
        expected = {
            "total": len(demand),
            "future": future,
            "active": active,
            "completed": completed,
            "waiting_outside": outside,
            "rejected": 0,
            "scheduled_by_time": len(demand) - future,
        }
        for key, value in expected.items():
            close(row[key], value)
        positions = trajectory[t]
        if len({p["visitor_id"] for p in positions}) != len(positions):
            raise ValueError("duplicate trajectory visitor in one snapshot")
        close(len(positions), active)
    for row in rows(directory, "zones"):
        area = zones[row["zone_id"]]
        inside = [
            p
            for p in trajectory[float(row["time_s"])]
            if area.covers(Point(float(p["x_m"]), float(p["y_m"])))
        ]
        close(row["count"], len(inside))
        close(row["usable_area_m2"], area.area)
        close(row["density_per_m2"], len(inside) / area.area)
        speeds = [float(p["speed_m_s"]) for p in inside if p["speed_m_s"] != ""]
        if speeds:
            close(row["mean_speed_m_s"], sum(speeds) / len(speeds))
        elif row["mean_speed_m_s"] != "":
            raise ValueError("empty speed sample must have null mean")
    counts = Counter()
    for event in crossings:
        a, b = lines[event["line_id"]]
        first, last = event["from_xy"], event["to_xy"]

        def side(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

        if side(first) * side(last) >= 0 or not LineString([first, last]).intersects(
            LineString([a, b])
        ):
            raise ValueError("invalid finite-segment crossing")
        direction = "positive" if side(last) > 0 else "negative"
        if event["direction"] != direction:
            raise ValueError("crossing direction mismatch")
        counts[(event["line_id"], direction)] += 1
    prior = {}
    for row in rows(directory, "flow"):
        t, key, window = float(row["time_s"]), row["line_id"], float(row["window_s"])
        start = prior.get(key, t)
        close(window, t - start)
        for direction in ("positive", "negative"):
            n = sum(
                e["line_id"] == key
                and e["direction"] == direction
                and start < e["to_time_s"] <= t + 1e-9
                for e in crossings
            )
            close(row[f"{direction}_crossings"], n)
            if window:
                close(row[f"{direction}_per_s"], n / window)
        prior[key] = t
    for key, totals in manifest["line_crossings"].items():
        for direction in ("positive", "negative"):
            close(totals[direction], counts[(key, direction)])
    final = ledger[-1]
    for key, value in manifest["population"].items():
        close(value, final[key])
    close(manifest["censored_visitors"], len(demand) - len(completions))
    now = manifest["simulated_time_s"]
    for v in visitors:
        if v["completed_s"] is not None:
            close(v["completed_s"], completions[v["visitor_id"]])
        if v["admitted_s"] is not None:
            close(v["admitted_s"], admissions[v["visitor_id"]])
        wait = max(0, (v["admitted_s"] if v["admitted_s"] is not None else now) - v["arrival_s"])
        close(v["outside_wait_s"], wait)
    return {
        "status": "passed",
        "snapshots": len(ledger),
        "visitors": len(demand),
        "trajectory_rows": sum(len(value) for value in trajectory.values()),
        "checks": [
            "hashes",
            "population_from_events",
            "usable_area_density",
            "displacement_speed_and_zone_mean",
            "directional_flow",
            "censored_waiting",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print(json.dumps(audit(parser.parse_args().directory)))
