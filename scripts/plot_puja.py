#!/usr/bin/env python3
"""Plot venue geometry and measured tradeoffs from a completed scenario study."""

import argparse
import json
from pathlib import Path
from statistics import mean

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Polygon as Patch  # noqa: E402

LABELS = {
    "baseline": "Baseline",
    "second_exit": "Second exit + routes",
    "staggered": "Staggered arrivals",
}
COLOURS = {"baseline": "#2467a2", "second_exit": "#cf7b21", "staggered": "#8758a0"}


def save(fig, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(target.with_suffix(".png"), dpi=170)
    svg = target.with_suffix(".svg")
    fig.savefig(svg)
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
    plt.close(fig)


def venue_plot(study, count, seed, output, report):
    fig, axes = plt.subplots(1, 2, figsize=(12, 5), layout="constrained")
    for ax, variant in zip(axes, ("baseline", "second_exit"), strict=True):
        scenario = json.loads(
            (study / "runs" / f"n{count}_s{seed}_{variant}" / "scenario.json").read_text()
        )
        ax.set_facecolor("#fafafa")
        geometry = scenario["geometry"]
        ax.add_patch(Patch(geometry["boundary"], facecolor="#edf2f5", edgecolor="#444"))
        for obstacle in geometry["obstacles"]:
            ax.add_patch(Patch(obstacle, facecolor="#b3b8be", edgecolor="#777"))
        zone = next(z for z in scenario["zones"] if z["id"] == "medical_access")
        ax.add_patch(Patch(zone["polygon"], facecolor="#cfe3dd", alpha=0.7))
        ax.text(24, 37, "Reserved access strip", ha="center", va="center", fontsize=9)
        for origin in scenario["origins"]:
            xs, ys = zip(*origin["positions"], strict=True)
            ax.scatter(xs, ys, marker=">" if origin["id"] == "A" else "^", s=30, color="#2467a2")
            ax.text(
                3 if origin["id"] == "A" else 22,
                25 if origin["id"] == "A" else 3,
                f"Entry {origin['id']}",
                fontsize=9,
                ha="center",
            )
        for index, service in enumerate(scenario["services"]):
            xs, ys = zip(*service["positions"], strict=True)
            ax.plot(xs, ys, "o--", markersize=2, color="#745084", linewidth=1)
            ax.text(31, ys[0] + 0.7, f"Visit lane {index + 1}", fontsize=8, ha="center")
        ax.text(40, 28, "Pandal", ha="center", fontsize=10)
        ax.text(15, 7.5, "Storage", ha="center", fontsize=8)
        ax.text(12, 27, "Facility", ha="center", fontsize=7)
        for line in scenario["lines"]:
            xs, ys = zip(*line["points"], strict=True)
            ax.plot(xs, ys, color="#b34d35", linewidth=4)
            ax.text(
                51,
                mean(ys),
                "Main" if line["id"] == "main_gate" else "Second",
                fontsize=8,
                va="center",
            )
        for exit_ in scenario["exits"]:
            ax.add_patch(Patch(exit_["polygon"], facecolor="#ecb6a9", edgecolor="#b34d35"))
        ax.set(xlim=(-1, 61), ylim=(-1, 41), title=LABELS[variant], xlabel="x (m)", ylabel="y (m)")
        ax.set_aspect("equal")
    fig.suptitle("Synthetic Puja venue • 60 × 40 m envelope", fontsize=15)
    fig.supxlabel(
        f"Source: saved scenario inputs • study {report['study_sha256'][:12]}\n"
        "Three service queues; fixed assigned routes; access strip is not vehicle certification.",
        fontsize=8,
    )
    save(fig, output / "venue")


def comparison_plot(output, report, focus_count):
    fig, axes = plt.subplots(3, 2, figsize=(12, 11), layout="constrained")
    counts = sorted({run["key"][0] for run in report["runs"]})
    horizon = report["runs"][0]["summary"]["horizon_s"]
    for variant in LABELS:
        for axis, metric, title, unit in [
            (
                axes[0, 0],
                "restricted_mean_journey_s",
                "Observed mean journey time (unfinished: lower bound)",
                "seconds",
            ),
            (axes[0, 1], "peak_active_count", "Peak simultaneous population inside", "people"),
        ]:
            averages, lower, upper = [], [], []
            for count in counts:
                values = [
                    r["summary"]["metrics"][metric]
                    for r in report["runs"]
                    if r["key"][0] == count
                    and r["key"][2] == variant
                    and r["summary"]["usable_for_comparison"]
                ]
                if not values or any(v is None for v in values):
                    raise ValueError("plot requires usable runs with observed arrivals")
                middle = mean(values)
                averages.append(middle)
                lower.append(middle - min(values))
                upper.append(max(values) - middle)
            axis.errorbar(
                counts,
                averages,
                yerr=[lower, upper],
                marker="o",
                capsize=3,
                label=LABELS[variant],
                color=COLOURS[variant],
            )
            axis.set(title=title, xlabel="Total scheduled visitors", ylabel=unit)
            axis.grid(alpha=0.2)
    axes[0, 0].legend(fontsize=8)
    for variant in LABELS:
        for axis, metric, title in [
            (axes[1, 0], "unfinished_count", f"Unfinished at the {horizon:g} s horizon"),
            (axes[1, 1], "clearance_s", "All-person clearance (undefined if unfinished)"),
        ]:
            xs, averages, lower, upper = [], [], [], []
            for count in counts:
                values = [
                    r["summary"]["metrics"][metric]
                    for r in report["runs"]
                    if r["key"][0] == count and r["key"][2] == variant
                ]
                if any(value is None for value in values):
                    axis.annotate(
                        "undefined",
                        (count, 0.04 + list(LABELS).index(variant) * 0.07),
                        xycoords=("data", "axes fraction"),
                        color=COLOURS[variant],
                        fontsize=7,
                        ha="center",
                    )
                    continue
                middle = mean(values)
                xs.append(count)
                averages.append(middle)
                lower.append(middle - min(values))
                upper.append(max(values) - middle)
            axis.errorbar(
                xs,
                averages,
                yerr=[lower, upper],
                marker="o",
                capsize=3,
                label=LABELS[variant],
                color=COLOURS[variant],
            )
            axis.set(
                title=title,
                xlabel="Total scheduled visitors",
                ylabel="people" if metric == "unfinished_count" else "seconds",
            )
            axis.set_xlim(min(counts) - 50, max(counts) + 70)
            axis.grid(alpha=0.2)
    exposure = report["aggregated"][str(focus_count)]
    zone_ids = list(exposure["second_exit"]["zones"])
    for offset, variant in ((-0.2, "second_exit"), (0.2, "staggered")):
        values = [
            exposure[variant]["zones"][key]["sampled_person_s_delta"]["mean"] for key in zone_ids
        ]
        axes[2, 0].bar(
            [i + offset for i in range(len(zone_ids))],
            values,
            width=0.4,
            label=LABELS[variant],
            color=COLOURS[variant],
        )
    axes[2, 0].axhline(0, color="#555", linewidth=0.8)
    axes[2, 0].set_xticks(
        range(len(zone_ids)), [key.replace("_", "\n") for key in zone_ids], fontsize=7
    )
    axes[2, 0].set(
        title=f"Local exposure change • {focus_count} visitors",
        ylabel="person-seconds versus baseline",
    )
    axes[2, 0].legend(fontsize=8)
    for index, variant in enumerate(LABELS):
        runs = [r for r in report["runs"] if r["key"][0] == focus_count and r["key"][2] == variant]
        main = mean(
            r["summary"]["gate_crossings"].get("main_gate", {}).get("negative", 0) for r in runs
        )
        second = mean(
            r["summary"]["gate_crossings"].get("second_gate", {}).get("negative", 0) for r in runs
        )
        axes[2, 1].bar(index, main, color="#2467a2", label="Main gate" if index == 0 else None)
        axes[2, 1].bar(
            index, second, bottom=main, color="#cf7b21", label="Second gate" if index == 0 else None
        )
    axes[2, 1].set_xticks(range(3), list(LABELS.values()), fontsize=8)
    axes[2, 1].set(
        title=f"Outgoing gate crossings • {focus_count} visitors", ylabel="mean crossings"
    )
    axes[2, 1].legend(fontsize=8)
    seed_count = len({r["key"][1] for r in report["runs"]})
    censored = sum(r["summary"]["metrics"]["unfinished_count"] for r in report["runs"])
    fig.suptitle("Measured tradeoffs in the synthetic event", fontsize=15)
    fig.supxlabel(
        f"{seed_count} seeds per condition • ranges show min–max simulation variability\n"
        f"Unfinished visitor-run records: {censored}; off-site scheduling costs are not modelled.\n"
        f"Source: comparison.json • study {report['study_sha256'][:12]} • no field calibration",
        fontsize=8,
    )
    save(fig, output / "comparison")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    report = json.loads((args.study / "comparison.json").read_text())
    venue_plot(args.study, args.count, args.seed, args.output, report)
    comparison_plot(args.output, report, args.count)


if __name__ == "__main__":
    main()
