"""Parameterized synthetic pandal; no real-venue calibration is implied."""

from typing import Literal

from pydantic import Field, model_validator
from shapely.geometry import box
from shapely.ops import unary_union

from pathway.schema import Number, Scenario, StrictModel

VARIANTS = ("baseline", "second_exit", "staggered")
Variant = Literal["baseline", "second_exit", "staggered"]


class PujaSettings(StrictModel):
    main_gate_width_m: Number = Field(default=1.2, ge=0, le=4)
    second_gate_width_m: Number = Field(default=2.4, gt=0.4, le=4)
    arrival_end_s: Number = Field(default=600, gt=0, le=1800)
    peak_end_s: Number = Field(default=180, gt=0)
    peak_fraction: Number = Field(default=0.7, ge=0, le=1)
    service_s: tuple[Number, Number] = (1.5, 3.0)
    speed_m_s: tuple[Number, Number] = (1.0, 1.4)
    horizon_s: Number = Field(default=1200, gt=0, le=3600)
    dt_s: Number = Field(default=0.01, ge=0.001, le=0.05)

    @model_validator(mode="after")
    def bounds(self):
        if not self.peak_end_s < self.arrival_end_s <= self.horizon_s:
            raise ValueError("require peak_end_s < arrival_end_s <= horizon_s")
        if self.main_gate_width_m and self.main_gate_width_m <= 0.4:
            raise ValueError("main gate must be closed (0) or wider than the 0.4 m body diameter")
        if not 0 <= self.service_s[0] <= self.service_s[1] <= 600:
            raise ValueError("invalid service duration range")
        if not 0.1 <= self.speed_m_s[0] <= self.speed_m_s[1] <= 3:
            raise ValueError("invalid walking speed range")
        return self


def ring(polygon):
    return [list(p) for p in polygon.exterior.coords][:-1]


def split_count(count, weights):
    """Largest-remainder integer allocation; deterministic ties follow input order."""
    raw = [count * w / sum(weights) for w in weights]
    result = [int(v) for v in raw]
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - result[i]), i))
    for i in order[: count - sum(result)]:
        result[i] += 1
    return result


def puja_scenario(variant: Variant = "baseline", count=500, seed=42, settings=None):
    if variant not in VARIANTS:
        raise ValueError(f"unknown Puja variant: {variant}")
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 750:
        raise ValueError("count must be an integer in 1..750")
    config = (
        settings
        if isinstance(settings, PujaSettings)
        else PujaSettings.model_validate(settings or {})
    )
    second_open = variant == "second_exit"
    if not config.main_gate_width_m and not second_open:
        raise ValueError("no open departure gate")
    parts = [box(0, 0, 48, 40), box(49, 10, 60, 30)]
    if config.main_gate_width_m:
        parts.append(box(47, 17, 50, 17 + config.main_gate_width_m))
    if second_open:
        parts.append(box(47, 26, 50, 26 + config.second_gate_width_m))
    walkable = unary_union(parts)
    obstacles = [box(36, 25, 44, 31), box(12, 5, 18, 10), box(10, 25, 14, 29), box(2, 33.5, 46, 34)]
    exclusions = [list(hole.coords)[:-1] for hole in walkable.interiors]
    exclusions.extend(ring(obstacle) for obstacle in obstacles)
    routes, demand = [], []
    for origin, origin_count in zip(("A", "B"), split_count(count, (0.6, 0.4)), strict=True):
        for lane, lane_count in enumerate(split_count(origin_count, (1, 1, 1))):
            for preference, group_count in zip(
                ("main", "second"), split_count(lane_count, (1, 1)), strict=True
            ):
                route_id = f"{origin}_lane{lane}_{preference}"
                exit_id = (
                    "second"
                    if second_open and (preference == "second" or not config.main_gate_width_m)
                    else "main"
                )
                routes.append(
                    {"id": route_id, "exit_id": exit_id, "service_ids": [f"visit_{lane}"]}
                )
                counts = split_count(group_count, (config.peak_fraction, 1 - config.peak_fraction))
                for pulse, pulse_count in zip(("peak", "tail"), counts, strict=True):
                    start = 0 if pulse == "peak" else config.peak_end_s
                    end = config.peak_end_s if pulse == "peak" else config.arrival_end_s
                    if variant == "staggered":
                        start, end = 0, config.arrival_end_s
                    demand.append(
                        {
                            "id": f"{route_id}_{pulse}",
                            "origin_id": origin,
                            "route_id": route_id,
                            "count": pulse_count,
                            "start_s": start,
                            "end_s": end,
                            "speed_m_s": config.speed_m_s,
                        }
                    )
    exits, lines = [], []
    if config.main_gate_width_m:
        y = 17 + config.main_gate_width_m / 2
        exits.append({"id": "main", "polygon": ring(box(57, y - 1, 59, y + 1))})
        lines.append(
            {"id": "main_gate", "points": [[48.5, 17], [48.5, 17 + config.main_gate_width_m]]}
        )
    if second_open:
        y = 26 + config.second_gate_width_m / 2
        exits.append({"id": "second", "polygon": ring(box(57, y - 1, 59, y + 1))})
        lines.append(
            {"id": "second_gate", "points": [[48.5, 26], [48.5, 26 + config.second_gate_width_m]]}
        )
    zones = {
        "approach_A": box(0.5, 18, 12, 25),
        "approach_B": box(18, 0.5, 26, 12),
        "junction": box(21, 15, 28, 26),
        "holding": box(18, 12, 28, 27),
        "service_queue": box(27, 16, 36, 26),
        "departure_merge": box(40, 14, 48, 24),
        "main_gate": box(46, 16, 50, 20),
        "second_gate": box(46, 25, 50, 30),
        "medical_access": box(1, 35, 47, 39),
    }
    return Scenario.model_validate(
        {
            "id": f"puja_{variant}_{count}",
            "seed": seed,
            "dt_s": config.dt_s,
            "horizon_s": config.horizon_s,
            "sample_interval_s": 1,
            "geometry": {"boundary": ring(walkable), "obstacles": exclusions},
            "origins": [
                {"id": "A", "positions": [[1, 19], [1, 21], [1, 23]]},
                {"id": "B", "positions": [[20, 1], [22, 1], [24, 1]]},
            ],
            "exits": exits,
            "routes": routes,
            "demand": demand,
            "lines": lines,
            "services": [
                {
                    "id": f"visit_{lane}",
                    "positions": [[x, y] for x in range(35, 27, -1)],
                    "duration_s": config.service_s,
                }
                for lane, y in enumerate((18, 21, 24))
            ],
            "zones": [{"id": key, "polygon": ring(area)} for key, area in zones.items()],
            "provenance": {
                "kind": "synthetic",
                "venue": "60x40 m envelope; flat; not a surveyed site",
                "arrivals": "60/40 origins; uniform within peak/tail windows; editable assumptions",
                "service": "three visit queues; synthetic durations, not a calibrated ritual model",
                "route_policy": "fixed assigned routes; nominal compliance; no rerouting model",
                "second_exit": "opening plus nominal 50% assignment within each service lane",
                "medical_access": "reserved strip with partial barrier; pedestrian occupancy only; "
                "no ambulance or stretcher certification",
            },
        }
    )
