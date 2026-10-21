"""Generate visitors once, independently of geometry and simulation iteration order."""

import hashlib
import random
from dataclasses import asdict, dataclass

from pathway.schema import Scenario, canonical_hash


def seeded_rng(seed: int, label: str):
    digest = hashlib.sha256(f"pathway-v1:{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest, "big"))


@dataclass(frozen=True)
class Visitor:
    id: str
    origin_id: str
    route_id: str
    arrival_s: float
    speed_m_s: float
    service_s: dict[str, float]
    spawn_offset: int


def generate_demand(scenario: Scenario) -> list[Visitor]:
    services = {s.id: s for s in scenario.services}
    routes = {r.id: r for r in scenario.routes}
    origins = {o.id: o for o in scenario.origins}
    visitors = []
    for stream in sorted(scenario.demand, key=lambda s: s.id):
        for index in range(stream.count):
            visitor_id = f"{stream.id}-{index:04d}"
            arrival = seeded_rng(scenario.seed, f"arrival:{visitor_id}").uniform(
                stream.start_s, stream.end_s
            )
            speed = seeded_rng(scenario.seed, f"speed:{visitor_id}").uniform(*stream.speed_m_s)
            durations = {
                s: seeded_rng(scenario.seed, f"service:{visitor_id}:{s}").uniform(
                    *services[s].duration_s
                )
                for s in routes[stream.route_id].service_ids
            }
            offset = seeded_rng(scenario.seed, f"spawn:{visitor_id}").randrange(
                len(origins[stream.origin_id].positions)
            )
            visitors.append(
                Visitor(
                    visitor_id, stream.origin_id, stream.route_id, arrival, speed, durations, offset
                )
            )
    return sorted(visitors, key=lambda v: (v.arrival_s, v.id))


def demand_hash(visitors):
    return canonical_hash([asdict(v) for v in visitors])
