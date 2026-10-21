"""Headless movement, outside-arrival ledger and single-server service stages."""

import math
import resource
import time
from collections import defaultdict, deque
from dataclasses import asdict

import jupedsim as jps
from shapely.geometry import Point, Polygon

from pathway.demand import demand_hash, generate_demand
from pathway.geometry import validate_geometry
from pathway.metrics import CrossingCounter, distribution, zone_measurement
from pathway.output import Output, environment, write_json
from pathway.schema import Scenario, canonical_hash


def run_scenario(scenario: Scenario, directory, *, wall_timeout_s=120, cancel_requested=None):
    if not math.isfinite(wall_timeout_s) or wall_timeout_s < 0:
        raise ValueError("wall_timeout_s must be finite and >= 0")
    # Revalidate copies so mutation of a nested list cannot bypass preflight.
    scenario = Scenario.model_validate_json(scenario.model_dump_json())
    started = time.perf_counter()
    walkable = validate_geometry(scenario)
    visitors = generate_demand(scenario)
    output = Output(directory)
    write_json(output.path / "scenario.json", scenario.model_dump(mode="json"))
    write_json(output.path / "demand.json", [asdict(v) for v in visitors])
    records = {
        v.id: {
            "visitor_id": v.id,
            "origin_id": v.origin_id,
            "route_id": v.route_id,
            "arrival_s": v.arrival_s,
            "admitted_s": None,
            "completed_s": None,
            "state": "future",
            "admission_attempts": 0,
            "services": {},
        }
        for v in visitors
    }
    by_id = {v.id: v for v in visitors}
    origins = {o.id: o for o in scenario.origins}
    waiting = defaultdict(deque)
    engine_to_visitor = {}
    service_stage = {}
    service_active = {}
    completed_services = set()
    queued_ids = set()
    speeds = {}
    speed_from_positions = {}
    speed_window_s = scenario.dt_s
    positions = {}
    positions_time_s = 0.0
    counters = {line.id: CrossingCounter(line.points) for line in scenario.lines}
    flow_previous = {line.id: (0, 0) for line in scenario.lines}
    zone_polygons = {z.id: Polygon(z.polygon).intersection(walkable) for z in scenario.zones}
    zone_peaks = {z.id: 0 for z in scenario.zones}
    last_sample_s = None
    cursor = 0
    now = 0.0
    status, error = "running", None
    simulation = None
    samples_written = 0

    def population():
        states = [r["state"] for r in records.values()]
        result = {
            "time_s": now,
            "total": len(visitors),
            "future": states.count("future"),
            "waiting_outside": states.count("waiting_outside"),
            "active": sum(s in {"walking", "queued", "serving"} for s in states),
            "completed": states.count("completed"),
            "rejected": 0,
            "queued": states.count("queued"),
            "serving": states.count("serving"),
        }
        result["scheduled_by_time"] = result["total"] - result["future"]
        if sum(
            result[k] for k in ("future", "waiting_outside", "active", "completed", "rejected")
        ) != len(visitors):
            raise RuntimeError("population conservation failed")
        if result["active"] != len(engine_to_visitor):
            raise RuntimeError("population ledger disagrees with engine membership")
        return result

    def snapshot():
        nonlocal last_sample_s, samples_written
        output.row("ledger", population())
        for key, point in positions.items():
            if not all(math.isfinite(x) for x in point) or not walkable.covers(Point(point)):
                raise RuntimeError(f"invalid engine position for visitor {key}")
            output.row(
                "trajectories",
                {
                    "time_s": now,
                    "visitor_id": key,
                    "x_m": point[0],
                    "y_m": point[1],
                    "speed_m_s": speeds.get(key),
                    "state": records[key]["state"],
                    "from_x_m": speed_from_positions[key][0]
                    if speeds.get(key) is not None
                    else None,
                    "from_y_m": speed_from_positions[key][1]
                    if speeds.get(key) is not None
                    else None,
                    "speed_window_s": speed_window_s if speeds.get(key) is not None else None,
                },
            )
        for key, area in zone_polygons.items():
            metric = zone_measurement(area, positions, speeds)
            zone_peaks[key] = max(zone_peaks[key], metric["density_per_m2"])
            output.row("zones", {"time_s": now, "zone_id": key, **metric})
        window = 0 if last_sample_s is None else now - last_sample_s
        for key, counter in counters.items():
            old_positive, old_negative = flow_previous[key]
            positive, negative = counter.positive - old_positive, counter.negative - old_negative
            output.row(
                "flow",
                {
                    "time_s": now,
                    "line_id": key,
                    "window_s": window,
                    "positive_crossings": positive,
                    "negative_crossings": negative,
                    "positive_per_s": positive / window if window else None,
                    "negative_per_s": negative / window if window else None,
                },
            )
            flow_previous[key] = (counter.positive, counter.negative)
        last_sample_s = now
        samples_written += 1

    try:
        model = scenario.model
        simulation = jps.Simulation(
            model=jps.CollisionFreeSpeedModel(
                strength_neighbor_repulsion=model.strength_neighbor_repulsion,
                range_neighbor_repulsion=model.range_neighbor_repulsion,
                strength_geometry_repulsion=model.strength_geometry_repulsion,
                range_geometry_repulsion=model.range_geometry_repulsion,
            ),
            geometry=walkable,
            dt=scenario.dt_s,
        )
        exits = {e.id: simulation.add_exit_stage(Polygon(e.polygon)) for e in scenario.exits}
        service_stage = {s.id: simulation.add_queue_stage(s.positions) for s in scenario.services}
        journeys = {}
        for route in scenario.routes:
            stages = [service_stage[s] for s in route.service_ids] + [exits[route.exit_id]]
            journey = jps.JourneyDescription(stages)
            for a, b in zip(stages, stages[1:]):
                journey.set_transition_for_stage(a, jps.Transition.create_fixed_transition(b))
            journeys[route.id] = (simulation.add_journey(journey), stages[0])
        sample_steps = round(scenario.sample_interval_s / scenario.dt_s)
        for step in range(round(scenario.horizon_s / scenario.dt_s) + 1):
            now = round(step * scenario.dt_s, 9)
            while cursor < len(visitors) and visitors[cursor].arrival_s <= now + 1e-9:
                visitor = visitors[cursor]
                records[visitor.id]["state"] = "waiting_outside"
                waiting[visitor.origin_id].append(visitor)
                output.event("arrival", now, visitor.id, scheduled_s=visitor.arrival_s)
                cursor += 1
            if cancel_requested is not None and cancel_requested():
                status = "cancelled"
                break
            if time.perf_counter() - started >= wall_timeout_s:
                status = "timed_out"
                break
            # FIFO per origin; blocked visitors are retried, never silently discarded.
            for origin_id in sorted(waiting):
                queue = waiting[origin_id]
                candidates = origins[origin_id].positions
                while queue:
                    visitor = queue[0]
                    record = records[visitor.id]
                    record["admission_attempts"] += 1
                    position = None
                    for offset in range(len(candidates)):
                        candidate = candidates[(visitor.spawn_offset + offset) % len(candidates)]
                        if (
                            next(
                                iter(
                                    simulation.agents_in_range(candidate, 2 * model.radius_m + 0.02)
                                ),
                                None,
                            )
                            is None
                        ):
                            position = candidate
                            break
                    if position is None:
                        break
                    journey_id, stage_id = journeys[visitor.route_id]
                    engine_id = simulation.add_agent(
                        jps.CollisionFreeSpeedModelAgentParameters(
                            position=position,
                            desired_speed=visitor.speed_m_s,
                            radius=model.radius_m,
                            time_gap=model.time_gap_s,
                            journey_id=journey_id,
                            stage_id=stage_id,
                        )
                    )
                    engine_to_visitor[engine_id] = visitor.id
                    record.update(state="walking", admitted_s=now)
                    queue.popleft()
                    output.event("admission", now, visitor.id, position=position)
            queued_ids = set()
            for service in scenario.services:
                proxy = simulation.get_stage(service_stage[service.id])
                enqueued = proxy.enqueued()
                for engine_id in enqueued:
                    key = engine_to_visitor[engine_id]
                    if (key, service.id) in completed_services:
                        continue
                    queued_ids.add(key)
                    visit = records[key]["services"].setdefault(service.id, {})
                    if "queued_s" not in visit:
                        visit["queued_s"] = now
                        output.event("queue_join", now, key, service_id=service.id)
                active = service_active.get(service.id)
                if active is not None and now + 1e-9 >= active[1]:
                    key, _ = active
                    if not enqueued or engine_to_visitor[enqueued[0]] != key:
                        raise RuntimeError(f"service {service.id}: serving visitor lost queue head")
                    proxy.pop(1)
                    records[key]["services"][service.id]["end_s"] = now
                    completed_services.add((key, service.id))
                    queued_ids.discard(key)
                    output.event("service_end", now, key, service_id=service.id)
                    del service_active[service.id]
                    continue  # Engine applies pop on the following iteration.
                if active is None and enqueued:
                    engine_id = enqueued[0]
                    key = engine_to_visitor[engine_id]
                    point = simulation.agent(engine_id).position
                    if (key, service.id) not in completed_services and math.dist(
                        point, service.positions[0]
                    ) <= service.head_tolerance_m:
                        visit = records[key]["services"][service.id]
                        visit["start_s"] = now
                        service_active[service.id] = (key, now + by_id[key].service_s[service.id])
                        output.event("service_start", now, key, service_id=service.id)
            serving = {value[0] for value in service_active.values()}
            current = {}
            for agent in simulation.agents():
                key = engine_to_visitor[agent.id]
                current[key] = tuple(agent.position)
                records[key]["state"] = (
                    "serving" if key in serving else "queued" if key in queued_ids else "walking"
                )
            # New admissions have no displacement speed yet.
            speed_from_positions = positions
            speed_window_s = scenario.dt_s
            speeds = {
                key: math.dist(point, positions[key]) / scenario.dt_s if key in positions else None
                for key, point in current.items()
            }
            positions = current
            positions_time_s = now
            for key, counter in counters.items():
                for event in counter.observe(positions, now):
                    output.crossing({"line_id": key, **event})
            ledger = population()
            if ledger["completed"] == len(visitors):
                status = "succeeded"
            elif step == round(scenario.horizon_s / scenario.dt_s):
                status = "horizon_reached"
            if step % sample_steps == 0 or status != "running":
                snapshot()
            if status != "running":
                break
            simulation.iterate()
            # JuPedSim 1.4.2 reports exit IDs one step before they disappear
            # from agents(). Use actual membership, not the early notification.
            remaining = (
                {a.id for a in simulation.agents()}
                if simulation.agent_count() != len(engine_to_visitor)
                else engine_to_visitor.keys()
            )
            for engine_id in engine_to_visitor.keys() - remaining:
                key = engine_to_visitor.pop(engine_id)
                records[key].update(state="completed", completed_s=round(now + scenario.dt_s, 9))
                output.event("completion", round(now + scenario.dt_s, 9), key)
    except KeyboardInterrupt:
        status = "cancelled"
    except Exception as exc:
        status, error = "failed", f"{type(exc).__name__}: {exc}"
    finally:
        # Controls can interrupt between sample boundaries. Keep partial output explicit.
        if last_sample_s != now:
            # Membership may change during the last engine iteration; rebuild before final sample.
            if simulation is not None:
                current = {
                    engine_to_visitor[a.id]: tuple(a.position)
                    for a in simulation.agents()
                    if a.id in engine_to_visitor
                }
                if now > positions_time_s:
                    speed_from_positions = positions
                    speed_window_s = now - positions_time_s
                    speeds = {
                        key: math.dist(point, positions[key]) / (now - positions_time_s)
                        if key in positions
                        else None
                        for key, point in current.items()
                    }
                positions = current
            try:
                for key, counter in counters.items():
                    for event in counter.observe(positions, now):
                        output.crossing({"line_id": key, **event})
                snapshot()
            except Exception as exc:
                status, error = "failed", f"final snapshot: {exc}"
        output.event("terminal", now, status=status, error=error)
        output.close()

    ledger = population()
    completed = [r for r in records.values() if r["completed_s"] is not None]
    for record in records.values():
        for visit in record["services"].values():
            visit["queue_wait_s"] = (
                visit["start_s"] - visit["queued_s"] if "start_s" in visit else None
            )
            visit["observed_queue_wait_s"] = visit.get("start_s", now) - visit["queued_s"]
            visit["observed_service_s"] = (
                visit.get("end_s", now) - visit["start_s"] if "start_s" in visit else 0
            )
        record["outside_wait_s"] = (
            (record["admitted_s"] if record["admitted_s"] is not None else now)
            - record["arrival_s"]
            if record["arrival_s"] <= now
            else 0
        )
        record["elapsed_journey_s"] = (
            (record["completed_s"] if record["completed_s"] is not None else now)
            - record["arrival_s"]
            if record["arrival_s"] <= now
            else None
        )
        record["censored"] = record["state"] != "completed"
    write_json(output.path / "visitors.json", list(records.values()))
    elapsed = time.perf_counter() - started
    manifest = {
        "schema_version": "1.0",
        "scenario_id": scenario.id,
        "scenario_sha256": canonical_hash(scenario),
        "demand_sha256": demand_hash(visitors),
        "seed": scenario.seed,
        "seed_scheme": "sha256(pathway-v1:seed:stream:visitor)",
        "environment": environment(),
        "model": scenario.model.model_dump(),
        "dt_s": scenario.dt_s,
        "sample_interval_s": scenario.sample_interval_s,
        "status": status,
        "error": error,
        "simulated_time_s": now,
        "horizon_s": scenario.horizon_s,
        "wall_time_s": elapsed,
        "peak_process_rss_kib_linux": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "population": ledger,
        "snapshots": samples_written,
        "all_person_clearance_s": now if ledger["completed"] == len(visitors) else None,
        "completed_journey_time": distribution(
            [r["completed_s"] - r["arrival_s"] for r in completed]
        ),
        "completed_inside_time": distribution(
            [r["completed_s"] - r["admitted_s"] for r in completed]
        ),
        "censored_visitors": len(visitors) - len(completed),
        "services": {
            service.id: {
                "started": sum(
                    "start_s" in r["services"].get(service.id, {}) for r in records.values()
                ),
                "finished": sum(
                    "end_s" in r["services"].get(service.id, {}) for r in records.values()
                ),
                "queue_wait_for_started": distribution(
                    [
                        r["services"][service.id]["queue_wait_s"]
                        for r in records.values()
                        if "start_s" in r["services"].get(service.id, {})
                    ]
                ),
            }
            for service in scenario.services
        },
        "peak_sampled_zone_density_per_m2": zone_peaks,
        "line_crossings": {
            key: {"positive": c.positive, "negative": c.negative} for key, c in counters.items()
        },
        "limitations": [
            "Synthetic inputs; no field calibration or predictive safety validation.",
            "Zone metrics sampled at sample_interval_s; sub-sample density peaks are not reported.",
            "Crossings use per-step positions; endpoint touch counts only when side changes.",
            "Service queue order is engine-enqueued order; outside admission is FIFO per origin.",
            "Completion-time statistics condition on completion; censored visitors are separate.",
            "RSS is process lifetime peak on Linux, not incremental per-run memory.",
        ],
        "output_sha256": output.hashes(),
    }
    write_json(output.path / "manifest.json", manifest)
    return manifest
