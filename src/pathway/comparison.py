"""Paired observations and transparent tradeoffs, including unfinished visitors."""

import csv
import json
import math
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from statistics import mean, median

from shapely.geometry import Point, Polygon

from pathway.audit import audit
from pathway.demand import demand_hash, generate_demand
from pathway.schema import canonical_hash


def identity_hash(visitors):
    """Arrival time alone may differ for a schedule intervention."""
    values = []
    for visitor in sorted(visitors, key=lambda v: v.id):
        value = asdict(visitor)
        del value["arrival_s"]
        values.append(value)
    return canonical_hash(values)


def check_pairing(scenarios):
    demands = {name: generate_demand(scenario) for name, scenario in scenarios.items()}
    signatures = {name: identity_hash(visitors) for name, visitors in demands.items()}
    if len(set(signatures.values())) != 1:
        raise ValueError("unmatched visitor identity, speed, service, route or spawn attributes")
    hashes = {name: demand_hash(visitors) for name, visitors in demands.items()}
    if hashes["baseline"] != hashes["second_exit"]:
        raise ValueError("exit intervention changed demand")
    base_arrival = {v.id: v.arrival_s for v in demands["baseline"]}
    shifts = [v.arrival_s - base_arrival[v.id] for v in demands["staggered"]]
    return {
        "identity_sha256": signatures["baseline"],
        "demand_sha256": hashes,
        "arrival_change": "staggered only; other generated visitor attributes identical",
        "staggered_arrival_shift_s": {
            **describe(shifts),
            "earlier": sum(s < 0 for s in shifts),
            "later": sum(s > 0 for s in shifts),
            "sum_positive_shift_s": sum(max(0, s) for s in shifts),
        },
    }


def paired_visitors(baseline_directory, alternative_directory):
    baseline_directory, alternative_directory = (
        Path(baseline_directory),
        Path(alternative_directory),
    )
    base_demand = {v["id"]: v for v in json.loads((baseline_directory / "demand.json").read_text())}
    alternate_demand = {
        v["id"]: v for v in json.loads((alternative_directory / "demand.json").read_text())
    }
    base_visits = {
        v["visitor_id"]: v for v in json.loads((baseline_directory / "visitors.json").read_text())
    }
    alternate_visits = {
        v["visitor_id"]: v
        for v in json.loads((alternative_directory / "visitors.json").read_text())
    }
    if base_demand.keys() != alternate_demand.keys():
        raise ValueError("missing paired visitors")
    for key in sorted(base_demand):
        a, b = base_demand[key], alternate_demand[key]
        if {k: v for k, v in a.items() if k != "arrival_s"} != {
            k: v for k, v in b.items() if k != "arrival_s"
        }:
            raise ValueError(f"unmatched attributes for {key}")
        av, bv = base_visits[key], alternate_visits[key]
        yield {
            "visitor_id": key,
            "origin_id": a["origin_id"],
            "baseline_arrival_s": a["arrival_s"],
            "alternative_arrival_s": b["arrival_s"],
            "arrival_shift_s": b["arrival_s"] - a["arrival_s"],
            "speed_m_s": a["speed_m_s"],
            "requested_service_s": sum(a["service_s"].values()),
            "baseline_completed_s": av["completed_s"],
            "alternative_completed_s": bv["completed_s"],
            "baseline_censored": av["censored"],
            "alternative_censored": bv["censored"],
            "baseline_outside_wait_s": av["outside_wait_s"],
            "alternative_outside_wait_s": bv["outside_wait_s"],
        }


def read_csv(directory, name):
    with (Path(directory) / f"{name}.csv").open() as file:
        return list(csv.DictReader(file))


def describe(values):
    values = list(values)
    if not values:
        return {"n": 0, "mean": None, "median": None, "min": None, "max": None}
    return {
        "n": len(values),
        "mean": mean(values),
        "median": median(values),
        "min": min(values),
        "max": max(values),
    }


def summarize_zone(rows, slow_speed_m_s):
    person_seconds, occupied_s, slow_s = 0.0, 0.0, 0.0
    for a, b in zip(rows, rows[1:]):
        dt = float(b["time_s"]) - float(a["time_s"])
        person_seconds += (int(a["count"]) + int(b["count"])) / 2 * dt
        occupied_s += dt if int(a["count"]) > 0 else 0
        slow_s += (
            dt
            if (
                int(a["count"]) > 0
                and a["mean_speed_m_s"] != ""
                and float(a["mean_speed_m_s"]) < slow_speed_m_s
            )
            else 0
        )
    return {
        "area_m2": float(rows[0]["usable_area_m2"]),
        "peak_count": max(int(row["count"]) for row in rows),
        "peak_density_per_m2": max(float(row["density_per_m2"]) for row in rows),
        "sampled_person_s": person_seconds,
        "sampled_occupied_s": occupied_s,
        "sampled_slow_s": slow_s,
    }


def summarize_run(directory, *, slow_speed_m_s=0.3):
    """Derive per-run metrics from immutable raw outputs, not from display state."""
    if not math.isfinite(slow_speed_m_s) or slow_speed_m_s < 0:
        raise ValueError("slow_speed_m_s must be finite and nonnegative")
    directory = Path(directory)
    audit_result = audit(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    scenario = json.loads((directory / "scenario.json").read_text())
    visitors = json.loads((directory / "visitors.json").read_text())
    ledger = read_csv(directory, "ledger")
    zone_rows = defaultdict(list)
    for row in read_csv(directory, "zones"):
        zone_rows[row["zone_id"]].append(row)
    zones = {key: summarize_zone(rows, slow_speed_m_s) for key, rows in zone_rows.items()}
    completed = [v for v in visitors if v["completed_s"] is not None]
    assigned_exits = {r["id"]: r["exit_id"] for r in scenario["routes"]}
    exit_counts = defaultdict(int)
    for visitor in completed:
        exit_counts[assigned_exits[visitor["route_id"]]] += 1
    observations = [v["elapsed_journey_s"] for v in visitors if v["elapsed_journey_s"] is not None]
    all_arrived = manifest["population"]["future"] == 0
    usable = manifest["status"] in {"succeeded", "horizon_reached"}
    measures = {
        "unfinished_count": len(visitors) - len(completed),
        "completed_count": len(completed),
        "clearance_s": manifest["all_person_clearance_s"],
        "restricted_mean_journey_s": mean(observations) if observations and all_arrived else None,
        "completed_journey_p95_s": manifest["completed_journey_time"]["p95_s"],
        "mean_outside_wait_s": mean(v["outside_wait_s"] for v in visitors) if visitors else 0,
        "total_formal_queue_wait_s": sum(
            visit["observed_queue_wait_s"] for v in visitors for visit in v["services"].values()
        ),
        "peak_outside_count": max(int(row["waiting_outside"]) for row in ledger),
        "peak_active_count": max(int(row["active"]) for row in ledger),
    }
    # Connectivity is for a pedestrian-sized centre path inside the reserved strip.
    walkable = Polygon(scenario["geometry"]["boundary"], scenario["geometry"]["obstacles"])
    corridor = next((z for z in scenario["zones"] if z["id"] == "medical_access"), None)
    corridor_connected = None
    if corridor:
        area = Polygon(corridor["polygon"]).intersection(walkable)
        area = area.buffer(-scenario["model"]["radius_m"])
        parts = [area] if area.geom_type == "Polygon" else list(getattr(area, "geoms", []))
        corridor_connected = any(p.covers(Point(2, 37)) and p.covers(Point(46, 37)) for p in parts)
    return {
        "status": manifest["status"],
        "usable_for_comparison": usable,
        "scenario_sha256": manifest["scenario_sha256"],
        "demand_sha256": manifest["demand_sha256"],
        "identity_sha256": canonical_hash(
            sorted(
                [
                    {key: value for key, value in v.items() if key != "arrival_s"}
                    for v in json.loads((directory / "demand.json").read_text())
                ],
                key=lambda v: v["id"],
            )
        ),
        "horizon_s": manifest["horizon_s"],
        "simulated_time_s": manifest["simulated_time_s"],
        "all_arrivals_observed": all_arrived,
        "population": manifest["population"],
        "metrics": measures,
        "zones": zones,
        "completion_by_assigned_exit": dict(exit_counts),
        "gate_crossings": manifest["line_crossings"],
        "reserved_strip_connected_for_model_radius": corridor_connected,
        "wall_time_s": manifest["wall_time_s"],
        "audit": audit_result,
        "measurement": {
            "sample_interval_s": manifest["sample_interval_s"],
            "slow_speed_m_s": slow_speed_m_s,
            "slow_rule": "occupied zone mean displacement speed below diagnostic threshold",
            "integration": "person-seconds trapezoidal; durations left-held samples",
            "threshold_is_safety_limit": False,
        },
    }


def pair_runs(baseline, alternative):
    if baseline["identity_sha256"] != alternative["identity_sha256"]:
        raise ValueError("cannot compare unmatched visitors")
    if baseline["horizon_s"] != alternative["horizon_s"]:
        raise ValueError("cannot compare different observation horizons")
    if baseline["measurement"] != alternative["measurement"]:
        raise ValueError("cannot compare different measurement definitions")
    usable = baseline["usable_for_comparison"] and alternative["usable_for_comparison"]
    if (
        not usable
        or not baseline["all_arrivals_observed"]
        or not alternative["all_arrivals_observed"]
    ):
        return {"status": "execution_incomplete", "deltas": {}, "zones": {}}
    deltas = {}
    for key, value in baseline["metrics"].items():
        alt = alternative["metrics"][key]
        # Completed-only tail times are not a fair comparison if completion differs.
        censored_tail = key == "completed_journey_p95_s" and (
            baseline["metrics"]["unfinished_count"] or alternative["metrics"]["unfinished_count"]
        )
        deltas[key] = (
            alt - value if value is not None and alt is not None and not censored_tail else None
        )
    zones = {}
    for key in baseline["zones"].keys() | alternative["zones"].keys():
        if key not in baseline["zones"] or key not in alternative["zones"]:
            raise ValueError(f"missing comparable measurement zone {key}")
        a, b = baseline["zones"][key], alternative["zones"][key]
        zones[key] = {
            "area_changed": abs(a["area_m2"] - b["area_m2"]) > 1e-8,
            "baseline_area_m2": a["area_m2"],
            "alternative_area_m2": b["area_m2"],
            "deltas": {metric: b[metric] - a[metric] for metric in a if metric != "area_m2"},
        }
    return {
        "status": "paired",
        "deltas": deltas,
        "zones": zones,
        "horizon_limited": baseline["status"] == "horizon_reached"
        or alternative["status"] == "horizon_reached",
        "worsened_zone_exposure": [
            key for key, zone in zones.items() if zone["deltas"]["sampled_person_s"] > 1e-8
        ],
    }


def aggregate_pairs(pairs):
    valid = [p for p in pairs if p["status"] == "paired"]
    keys = set().union(*(p["deltas"] for p in valid))
    metrics = {}
    for key in sorted(keys):
        values = [p["deltas"][key] for p in valid if p["deltas"][key] is not None]
        metrics[key] = {
            **describe(values),
            "undefined_pairs": len(valid) - len(values),
            "negative": sum(v < -1e-8 for v in values),
            "positive": sum(v > 1e-8 for v in values),
            "equal": sum(abs(v) <= 1e-8 for v in values),
        }
    zones = {}
    for key in sorted(set().union(*(p["zones"] for p in valid))):
        zones[key] = {
            "area_changed": any(p["zones"][key]["area_changed"] for p in valid),
            "sampled_person_s_delta": describe(
                p["zones"][key]["deltas"]["sampled_person_s"] for p in valid
            ),
            "seeds_worsened_exposure": sum(
                p["zones"][key]["deltas"]["sampled_person_s"] > 1e-8 for p in valid
            ),
        }
    return {
        "total_pairs": len(pairs),
        "valid_pairs": len(valid),
        "execution_incomplete": len(pairs) - len(valid),
        "horizon_limited_pairs": sum(p["horizon_limited"] for p in valid),
        "delta_definition": "alternative minus baseline",
        "metrics": metrics,
        "zones": zones,
    }
