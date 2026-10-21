"""Bounded local batch runs, immutable pairing and resumable comparison exports."""

import csv
import fcntl
import json
import math
import multiprocessing
import signal
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from pathway.comparison import (
    aggregate_pairs,
    check_pairing,
    pair_runs,
    paired_visitors,
    summarize_run,
)
from pathway.output import environment, write_json
from pathway.puja import VARIANTS, PujaSettings, puja_scenario
from pathway.runner import run_scenario
from pathway.schema import Scenario, canonical_hash

_cancel_event = None


def initialize_worker(cancel_event):
    global _cancel_event
    _cancel_event = cancel_event
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def run_case(payload):
    if _cancel_event is not None and _cancel_event.is_set():
        raise InterruptedError("study cancelled")
    scenario = Scenario.model_validate_json(payload["scenario"])
    path = Path(payload["path"])
    reused = path.exists()
    if reused:
        if not payload["resume"] or not (path / "manifest.json").exists():
            raise ValueError(f"unsealed or existing run at {path}; inspect it before retrying")
        manifest = json.loads((path / "manifest.json").read_text())
        if manifest["scenario_sha256"] != canonical_hash(scenario):
            raise ValueError(f"scenario changed for existing run {path}")
        if manifest["environment"]["kernel_source_sha256"] != payload["source_sha256"]:
            raise ValueError(f"implementation changed for existing run {path}")
        if manifest["environment"]["lock_sha256"] != payload["lock_sha256"]:
            raise ValueError(f"dependency lock changed for existing run {path}")
    else:
        run_scenario(
            scenario,
            path,
            wall_timeout_s=payload["wall_timeout_s"],
            cancel_requested=_cancel_event.is_set if _cancel_event is not None else None,
        )
    return {
        "key": payload["key"],
        "reused": reused,
        "summary": summarize_run(path, slow_speed_m_s=payload["slow_speed_m_s"]),
    }


def export_tables(output, records, pairs):
    with (output / "runs.csv").open("w", newline="") as file:
        fields = [
            "count",
            "seed",
            "variant",
            "status",
            "wall_time_s",
            *next(iter(records.values()))["summary"]["metrics"],
        ]
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for record in records.values():
            count, seed, variant = record["key"]
            summary = record["summary"]
            writer.writerow(
                {
                    "count": count,
                    "seed": seed,
                    "variant": variant,
                    "status": summary["status"],
                    "wall_time_s": summary["wall_time_s"],
                    **summary["metrics"],
                }
            )
    with (output / "zone-pairs.csv").open("w", newline="") as file:
        fields = ["count", "seed", "variant", "zone_id", "metric", "delta", "area_changed"]
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for record in pairs:
            for zone_id, zone in record["comparison"]["zones"].items():
                for metric, value in zone["deltas"].items():
                    writer.writerow(
                        {
                            "count": record["count"],
                            "seed": record["seed"],
                            "variant": record["variant"],
                            "zone_id": zone_id,
                            "metric": metric,
                            "delta": value,
                            "area_changed": zone["area_changed"],
                        }
                    )
    with (output / "visitor-pairs.csv").open("w", newline="") as file:
        writer = None
        for record in pairs:
            count, seed, variant = record["count"], record["seed"], record["variant"]
            base = output / "runs" / f"n{count}_s{seed}_baseline"
            alt = output / "runs" / f"n{count}_s{seed}_{variant}"
            for visitor in paired_visitors(base, alt):
                row = {"count": count, "seed": seed, "variant": variant, **visitor}
                if writer is None:
                    writer = csv.DictWriter(file, fieldnames=list(row))
                    writer.writeheader()
                writer.writerow(row)


def run_study(
    output,
    *,
    counts=(250, 500, 750),
    seeds=tuple(range(10)),
    workers=1,
    settings=None,
    resume=False,
    wall_timeout_s=180,
    slow_speed_m_s=0.3,
    progress=None,
):
    config = (
        settings
        if isinstance(settings, PujaSettings)
        else PujaSettings.model_validate(settings or {})
    )
    counts, seeds = tuple(counts), tuple(seeds)
    if not counts or not seeds or len(set(counts)) != len(counts) or len(set(seeds)) != len(seeds):
        raise ValueError("counts and seeds must be nonempty without duplicates")
    if isinstance(workers, bool) or not isinstance(workers, int) or not 1 <= workers <= 4:
        raise ValueError("workers must be an integer in 1..4")
    if not math.isfinite(wall_timeout_s) or wall_timeout_s < 0:
        raise ValueError("wall_timeout_s must be finite and nonnegative")
    if not math.isfinite(slow_speed_m_s) or slow_speed_m_s < 0:
        raise ValueError("slow_speed_m_s must be finite and nonnegative")
    scenarios, matching = {}, {}
    for count in counts:
        for seed in seeds:
            variants = {
                variant: puja_scenario(variant, count, seed, config) for variant in VARIANTS
            }
            matching[f"{count}/{seed}"] = check_pairing(variants)
            for variant, scenario in variants.items():
                scenarios[(count, seed, variant)] = scenario
    output = Path(output)
    output.mkdir(parents=True, exist_ok=resume)
    with (output / "study.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("another process holds this study directory") from exc
        source = environment()
        spec = {
            "schema_version": "1.0",
            "counts": counts,
            "seeds": seeds,
            "variants": VARIANTS,
            "settings": config.model_dump(mode="json"),
            "slow_speed_m_s": slow_speed_m_s,
            "kernel_source_sha256": source["kernel_source_sha256"],
            "lock_sha256": source["lock_sha256"],
            "matching": matching,
        }
        spec_hash = canonical_hash(spec)
        spec_path = output / "study.json"
        if resume:
            if not spec_path.exists() or json.loads(spec_path.read_text())["sha256"] != spec_hash:
                raise ValueError("study inputs or implementation differ; cannot resume")
        else:
            write_json(spec_path, {"sha256": spec_hash, "spec": spec, "environment": source})
        payloads = [
            {
                "key": key,
                "scenario": scenario.model_dump_json(),
                "path": str(output / "runs" / f"n{key[0]}_s{key[1]}_{key[2]}"),
                "resume": resume,
                "source_sha256": source["kernel_source_sha256"],
                "lock_sha256": source["lock_sha256"],
                "slow_speed_m_s": slow_speed_m_s,
                "wall_timeout_s": wall_timeout_s,
            }
            for key, scenario in scenarios.items()
        ]
        records = {}

        def collect(record):
            key = tuple(record["key"])
            records[key] = record
            if progress:
                progress(len(records), len(payloads), record)
            if record["summary"]["status"] == "cancelled":
                raise KeyboardInterrupt

        if workers == 1:
            for payload in payloads:
                collect(run_case(payload))
        else:
            context = multiprocessing.get_context("spawn")
            cancel_event = context.Event()
            pool = ProcessPoolExecutor(
                max_workers=workers,
                mp_context=context,
                initializer=initialize_worker,
                initargs=(cancel_event,),
            )
            jobs = []
            try:
                jobs = [pool.submit(run_case, payload) for payload in payloads]
                for job in as_completed(jobs):
                    collect(job.result())
            except BaseException:
                cancel_event.set()
                for job in jobs:
                    job.cancel()
                raise
            finally:
                pool.shutdown(wait=True, cancel_futures=True)
        # Sort independently of parallel completion order.
        records = {key: records[key] for key in sorted(records)}
        pairs, aggregated = [], {}
        for count in counts:
            aggregated[str(count)] = {}
            for variant in VARIANTS[1:]:
                subset = []
                for seed in seeds:
                    baseline = records[(count, seed, "baseline")]["summary"]
                    alternative = records[(count, seed, variant)]["summary"]
                    comparison = pair_runs(baseline, alternative)
                    subset.append(comparison)
                    pairs.append(
                        {"count": count, "seed": seed, "variant": variant, "comparison": comparison}
                    )
                aggregated[str(count)][variant] = aggregate_pairs(subset)
        report = {
            "schema_version": "1.0",
            "study_sha256": spec_hash,
            "requested_runs": len(payloads),
            "runs": list(records.values()),
            "pairing": matching,
            "pairs": pairs,
            "aggregated": aggregated,
            "execution_failures": sum(
                not r["summary"]["usable_for_comparison"] for r in records.values()
            ),
            "limitations": [
                "Synthetic assumptions; no local or field validation.",
                "Seed spread is stochastic variability, not forecast confidence.",
                "Second exit includes a fixed route assignment policy.",
                "Staggering changes arrival timing only; no suppressed visitors.",
                "Venue journey time excludes off-site scheduling; arrival shifts are exported.",
                "No single overall winner or safety score is calculated.",
                "Sampled zone peaks/durations can miss sub-sample changes.",
                "Reserved strip checks are for model-sized pedestrians, not vehicles.",
            ],
        }
        write_json(output / "comparison.json", report)
        export_tables(output, records, pairs)
        return report
