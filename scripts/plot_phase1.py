#!/usr/bin/env python3
"""Plot actual verification trajectories and service states for review/presentation."""

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def plot(runs, output):
    scenario = json.loads((runs / "crossing" / "scenario.json").read_text())
    trajectories = defaultdict(list)
    with (runs / "crossing" / "trajectories.csv").open() as file:
        for row in csv.DictReader(file):
            trajectories[row["visitor_id"]].append((float(row["x_m"]), float(row["y_m"])))
    fig, axes = plt.subplots(1, 2, figsize=(11, 5), layout="constrained")
    boundary = scenario["geometry"]["boundary"]
    closed = boundary + boundary[:1]
    axes[0].fill([p[0] for p in closed], [p[1] for p in closed], color="#eef3f7")
    axes[0].plot([p[0] for p in closed], [p[1] for p in closed], color="#555", linewidth=1)
    for key, points in trajectories.items():
        colour = "#1673b8" if key.startswith("west") else "#de7b1c"
        axes[0].plot(
            [p[0] for p in points], [p[1] for p in points], color=colour, alpha=0.65, linewidth=1
        )
    axes[0].set(title="24 pedestrians: crossing fixture", xlabel="x (m)", ylabel="y (m)")
    axes[0].set_aspect("equal")
    with (runs / "service" / "ledger.csv").open() as file:
        ledger = list(csv.DictReader(file))
    t = [float(row["time_s"]) for row in ledger]
    for field, label in [
        ("queued", "Enqueued, awaiting service"),
        ("serving", "Receiving service"),
        ("completed", "Completed journey"),
    ]:
        axes[1].step(t, [int(row[field]) for row in ledger], where="post", label=label)
    axes[1].set(
        title="12 pedestrians: service queue fixture", xlabel="Simulated time (s)", ylabel="People"
    )
    axes[1].legend(fontsize=8)
    axes[1].grid(alpha=0.2)
    fig.suptitle("Pathway • verified simulation kernel", fontsize=16)
    fig.supxlabel(
        "Synthetic verification cases • JuPedSim 1.4.2 • not a calibrated Puja model\n"
        "Source: phase1 synthetic-runs.zip, crossing/trajectories.csv and service/ledger.csv",
        fontsize=8,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=160)
    svg = output.with_suffix(".svg")
    fig.savefig(svg)
    # Matplotlib emits trailing spaces in path attributes; newlines retain separators.
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plot(args.runs, args.output)
