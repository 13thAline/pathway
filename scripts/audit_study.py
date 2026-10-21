#!/usr/bin/env python3
"""Check study completeness, pairing and summary exports against saved engine output."""

import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from itertools import product
from pathlib import Path
from statistics import mean, median

from pathway.audit import audit
from pathway.schema import canonical_hash


def approximately(a, b):
    if a is None or b is None:
        if a != b:
            raise ValueError("null/defined metric mismatch")
    elif not math.isclose(float(a), float(b), abs_tol=1e-8, rel_tol=1e-8):
        raise ValueError(f"study metric mismatch: {a} != {b}")


def without_arrivals(visitors):
    return sorted(
        ({k: v for k, v in visitor.items() if k != "arrival_s"} for visitor in visitors),
        key=lambda v: v["id"],
    )


def csv_rows(directory, name):
    with (directory / f"{name}.csv").open() as file:
        return list(csv.DictReader(file))


def check_zone_summaries(path, summary, threshold):
    zones = defaultdict(list)
    for row in csv_rows(path, "zones"):
        zones[row["zone_id"]].append(row)
    if zones.keys() != summary["zones"].keys():
        raise ValueError("zone summary keys mismatch")
    for key, rows in zones.items():
        expected = {
            "area_m2": float(rows[0]["usable_area_m2"]),
            "peak_count": max(int(r["count"]) for r in rows),
            "peak_density_per_m2": max(float(r["density_per_m2"]) for r in rows),
            "sampled_person_s": 0.0,
            "sampled_occupied_s": 0.0,
            "sampled_slow_s": 0.0,
        }
        for first, last in zip(rows, rows[1:]):
            dt = float(last["time_s"]) - float(first["time_s"])
            expected["sampled_person_s"] += dt * (int(first["count"]) + int(last["count"])) / 2
            if int(first["count"]):
                expected["sampled_occupied_s"] += dt
                if first["mean_speed_m_s"] and float(first["mean_speed_m_s"]) < threshold:
                    expected["sampled_slow_s"] += dt
        for metric, value in expected.items():
            approximately(summary["zones"][key][metric], value)


def check_distribution(result, values):
    approximately(result["n"], len(values))
    for name, func in (("mean", mean), ("median", median), ("min", min), ("max", max)):
        approximately(result[name], func(values) if values else None)


def audit_study(directory, *, deep=False, progress=None):
    directory = Path(directory)
    stored = json.loads((directory / "study.json").read_text())
    spec = stored["spec"]
    report = json.loads((directory / "comparison.json").read_text())
    if canonical_hash(spec) != stored["sha256"] or stored["sha256"] != report["study_sha256"]:
        raise ValueError("study specification hash mismatch")
    expected = set(product(spec["counts"], spec["seeds"], spec["variants"]))
    records = {tuple(r["key"]): r["summary"] for r in report["runs"]}
    if set(records) != expected or len(report["runs"]) != len(expected):
        raise ValueError("missing or duplicated study run")
    approximately(report["requested_runs"], len(expected))
    raw = {}
    for index, key in enumerate(sorted(expected), start=1):
        count, seed, variant = key
        path = directory / "runs" / f"n{count}_s{seed}_{variant}"
        manifest = json.loads((path / "manifest.json").read_text())
        if manifest["environment"]["kernel_source_sha256"] != spec["kernel_source_sha256"]:
            raise ValueError("mixed source versions in study")
        if manifest["environment"]["lock_sha256"] != spec["lock_sha256"]:
            raise ValueError("mixed dependency locks in study")
        if deep:
            audit(path)
        else:
            for filename, digest in manifest["output_sha256"].items():
                with (path / filename).open("rb") as file:
                    if hashlib.file_digest(file, "sha256").hexdigest() != digest:
                        raise ValueError(f"output hash mismatch: {path}/{filename}")
        demand = json.loads((path / "demand.json").read_text())
        visits = json.loads((path / "visitors.json").read_text())
        raw[key] = {"demand": demand, "visits": {v["visitor_id"]: v for v in visits}}
        summary = records[key]
        if summary["usable_for_comparison"] != (
            manifest["status"] in {"succeeded", "horizon_reached"}
        ):
            raise ValueError("summary usability mismatch")
        if (
            summary["status"] != manifest["status"]
            or summary["population"] != manifest["population"]
        ):
            raise ValueError("summary status/population mismatch")
        if summary["scenario_sha256"] != manifest["scenario_sha256"]:
            raise ValueError("summary scenario mismatch")
        metrics = summary["metrics"]
        completed = [v for v in visits if v["completed_s"] is not None]
        approximately(metrics["completed_count"], len(completed))
        approximately(metrics["unfinished_count"], count - len(completed))
        approximately(metrics["clearance_s"], manifest["all_person_clearance_s"])
        approximately(metrics["mean_outside_wait_s"], mean(v["outside_wait_s"] for v in visits))
        if manifest["population"]["future"] == 0:
            approximately(
                metrics["restricted_mean_journey_s"], mean(v["elapsed_journey_s"] for v in visits)
            )
        approximately(
            metrics["completed_journey_p95_s"], manifest["completed_journey_time"]["p95_s"]
        )
        approximately(
            metrics["total_formal_queue_wait_s"],
            sum(
                visit["observed_queue_wait_s"]
                for visitor in visits
                for visit in visitor["services"].values()
            ),
        )
        ledger = csv_rows(path, "ledger")
        approximately(metrics["peak_active_count"], max(int(row["active"]) for row in ledger))
        approximately(
            metrics["peak_outside_count"], max(int(row["waiting_outside"]) for row in ledger)
        )
        check_zone_summaries(path, summary, spec["slow_speed_m_s"])
        if progress and (index % 10 == 0 or index == len(expected)):
            progress(index, len(expected))
    for count, seed in product(spec["counts"], spec["seeds"]):
        baseline = raw[(count, seed, "baseline")]["demand"]
        second = raw[(count, seed, "second_exit")]["demand"]
        staggered = raw[(count, seed, "staggered")]["demand"]
        if baseline != second:
            raise ValueError("exit intervention changed generated demand")
        if without_arrivals(baseline) != without_arrivals(staggered):
            raise ValueError("staggering changed visitor attributes")
    expected_pairs = set(product(spec["counts"], spec["seeds"], spec["variants"][1:]))
    pairs = {(p["count"], p["seed"], p["variant"]): p["comparison"] for p in report["pairs"]}
    if set(pairs) != expected_pairs or len(report["pairs"]) != len(expected_pairs):
        raise ValueError("missing or duplicated paired comparison")
    for (count, seed, variant), pair in pairs.items():
        a, b = records[(count, seed, "baseline")], records[(count, seed, variant)]
        usable = all(s["usable_for_comparison"] and s["all_arrivals_observed"] for s in (a, b))
        if (pair["status"] == "paired") != usable:
            raise ValueError("pair usability mismatch")
        if pair["status"] != "paired":
            continue
        for metric, delta in pair["deltas"].items():
            if delta is not None:
                approximately(delta, b["metrics"][metric] - a["metrics"][metric])
        for zone, changes in pair["zones"].items():
            for metric, delta in changes["deltas"].items():
                approximately(delta, b["zones"][zone][metric] - a["zones"][zone][metric])
    for count, variant in product(spec["counts"], spec["variants"][1:]):
        aggregate = report["aggregated"][str(count)][variant]
        values = [pairs[(count, seed, variant)] for seed in spec["seeds"]]
        valid = [p for p in values if p["status"] == "paired"]
        approximately(aggregate["valid_pairs"], len(valid))
        approximately(aggregate["execution_incomplete"], len(values) - len(valid))
        approximately(aggregate["horizon_limited_pairs"], sum(p["horizon_limited"] for p in valid))
        for metric, result in aggregate["metrics"].items():
            deltas = [p["deltas"][metric] for p in valid if p["deltas"][metric] is not None]
            check_distribution(result, deltas)
            approximately(result["undefined_pairs"], len(valid) - len(deltas))
            approximately(result["negative"], sum(v < -1e-8 for v in deltas))
            approximately(result["positive"], sum(v > 1e-8 for v in deltas))
            approximately(result["equal"], sum(abs(v) <= 1e-8 for v in deltas))
        for zone, result in aggregate["zones"].items():
            deltas = [p["zones"][zone]["deltas"]["sampled_person_s"] for p in valid]
            check_distribution(result["sampled_person_s_delta"], deltas)
            approximately(result["seeds_worsened_exposure"], sum(d > 1e-8 for d in deltas))
            if result["area_changed"] != any(p["zones"][zone]["area_changed"] for p in valid):
                raise ValueError("zone area change mismatch")
    run_rows = csv_rows(directory, "runs")
    if len(run_rows) != len(records):
        raise ValueError("run CSV row count mismatch")
    seen_runs = set()
    for row in run_rows:
        key = (int(row["count"]), int(row["seed"]), row["variant"])
        if key in seen_runs:
            raise ValueError("duplicate run CSV row")
        seen_runs.add(key)
        if row["status"] != records[key]["status"]:
            raise ValueError("run CSV status mismatch")
        for metric, value in records[key]["metrics"].items():
            approximately(row[metric] if row[metric] else None, value)
    zone_export = {
        (count, seed, variant, zone, metric): (delta, change["area_changed"])
        for (count, seed, variant), pair in pairs.items()
        for zone, change in pair["zones"].items()
        for metric, delta in change["deltas"].items()
    }
    zone_rows = csv_rows(directory, "zone-pairs")
    if len(zone_rows) != len(zone_export):
        raise ValueError("zone CSV row count mismatch")
    seen_zones = set()
    for row in zone_rows:
        key = (int(row["count"]), int(row["seed"]), row["variant"], row["zone_id"], row["metric"])
        if key in seen_zones:
            raise ValueError("duplicate zone CSV row")
        seen_zones.add(key)
        delta, area_changed = zone_export[key]
        approximately(row["delta"] if row["delta"] else None, delta)
        if row["area_changed"] != str(area_changed):
            raise ValueError("zone CSV area flag mismatch")
    with (directory / "visitor-pairs.csv").open() as file:
        visitors = list(csv.DictReader(file))
    expected_visitors = sum(spec["counts"]) * len(spec["seeds"]) * (len(spec["variants"]) - 1)
    approximately(len(visitors), expected_visitors)
    keys = set()
    for row in visitors:
        count, seed, variant, key = (
            int(row["count"]),
            int(row["seed"]),
            row["variant"],
            row["visitor_id"],
        )
        signature = (count, seed, variant, key)
        if signature in keys:
            raise ValueError("duplicate paired visitor")
        keys.add(signature)
        a = raw[(count, seed, "baseline")]
        b = raw[(count, seed, variant)]
        av, bv = a["visits"][key], b["visits"][key]
        approximately(row["baseline_arrival_s"], av["arrival_s"])
        approximately(row["alternative_arrival_s"], bv["arrival_s"])
        approximately(row["arrival_shift_s"], bv["arrival_s"] - av["arrival_s"])
        approximately(row["baseline_outside_wait_s"], av["outside_wait_s"])
        approximately(row["alternative_outside_wait_s"], bv["outside_wait_s"])
        for label, visit in (("baseline", av), ("alternative", bv)):
            approximately(row[f"{label}_completed_s"] or None, visit["completed_s"])
            if row[f"{label}_censored"] != str(visit["censored"]):
                raise ValueError("visitor CSV censoring mismatch")
    return {
        "status": "passed",
        "runs": len(records),
        "pairs": len(pairs),
        "visitor_pairs": len(visitors),
        "deep_raw_audit": deep,
        "study_sha256": report["study_sha256"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--deep", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit_study(
        args.directory,
        deep=args.deep,
        progress=lambda n, total: print(f"audited {n}/{total}", flush=True),
    )
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
