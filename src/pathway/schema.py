"""Versioned, bounded scenario input. Geometry is validated separately."""

import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Number = Annotated[float, Field(allow_inf_nan=False)]
Point = tuple[Number, Number]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Ring = Annotated[list[Point], Field(min_length=3, max_length=2000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class Geometry(StrictModel):
    boundary: Ring
    obstacles: list[Ring] = Field(default_factory=list, max_length=100)


class Origin(StrictModel):
    id: Identifier
    positions: list[Point] = Field(min_length=1, max_length=500)


class Exit(StrictModel):
    id: Identifier
    polygon: Ring


class Service(StrictModel):
    id: Identifier
    positions: list[Point] = Field(min_length=1, max_length=100)
    duration_s: tuple[Number, Number] = (2.0, 2.0)
    head_tolerance_m: Number = Field(default=0.3, gt=0, le=1)

    @model_validator(mode="after")
    def duration_bounds(self):
        if not 0 <= self.duration_s[0] <= self.duration_s[1] <= 600:
            raise ValueError("service duration_s must be ordered in 0..600 seconds")
        return self


class Route(StrictModel):
    id: Identifier
    exit_id: Identifier
    service_ids: list[Identifier] = Field(default_factory=list, max_length=10)


class DemandStream(StrictModel):
    id: Identifier
    origin_id: Identifier
    route_id: Identifier
    count: int = Field(ge=0, le=750, strict=True)
    start_s: Number = Field(default=0, ge=0)
    end_s: Number = Field(default=0, ge=0)
    speed_m_s: tuple[Number, Number] = (1.0, 1.4)

    @model_validator(mode="after")
    def bounds(self):
        if self.end_s < self.start_s:
            raise ValueError("end_s must be >= start_s")
        if not 0.1 <= self.speed_m_s[0] <= self.speed_m_s[1] <= 3:
            raise ValueError("speed_m_s must be ordered in 0.1..3 m/s")
        return self


class Zone(StrictModel):
    id: Identifier
    polygon: Ring


class MeasurementLine(StrictModel):
    id: Identifier
    points: tuple[Point, Point]


class MovementModel(StrictModel):
    name: Literal["CollisionFreeSpeedModel"] = "CollisionFreeSpeedModel"
    radius_m: Number = Field(default=0.2, gt=0, le=0.5)
    time_gap_s: Number = Field(default=1, gt=0, le=5)
    strength_neighbor_repulsion: Number = Field(default=8, gt=0)
    range_neighbor_repulsion: Number = Field(default=0.1, gt=0)
    strength_geometry_repulsion: Number = Field(default=5, gt=0)
    range_geometry_repulsion: Number = Field(default=0.02, gt=0)


class Scenario(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    id: Identifier
    revision: int = Field(default=1, ge=1, strict=True)
    units: Literal["metres_seconds"] = "metres_seconds"
    provenance: dict[str, str] = Field(default_factory=lambda: {"kind": "synthetic"})
    geometry: Geometry
    origins: list[Origin] = Field(min_length=1, max_length=50)
    exits: list[Exit] = Field(min_length=1, max_length=50)
    services: list[Service] = Field(default_factory=list, max_length=50)
    routes: list[Route] = Field(min_length=1, max_length=100)
    demand: list[DemandStream] = Field(default_factory=list, max_length=100)
    zones: list[Zone] = Field(default_factory=list, max_length=100)
    lines: list[MeasurementLine] = Field(default_factory=list, max_length=100)
    seed: int = Field(default=42, ge=0, le=2**32 - 1, strict=True)
    dt_s: Number = Field(default=0.01, ge=0.001, le=0.05)
    sample_interval_s: Number = Field(default=1, ge=0.01, le=10)
    horizon_s: Number = Field(default=1200, gt=0, le=3600)
    model: MovementModel = Field(default_factory=MovementModel)

    @model_validator(mode="after")
    def references(self):
        for label in ("origins", "exits", "services", "routes", "demand", "zones", "lines"):
            ids = [v.id for v in getattr(self, label)]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {label} id")
        origins = {v.id for v in self.origins}
        exits = {v.id for v in self.exits}
        services = {v.id for v in self.services}
        routes = {v.id for v in self.routes}
        for route in self.routes:
            if route.exit_id not in exits or not set(route.service_ids) <= services:
                raise ValueError(f"route {route.id}: unknown exit or service")
            if len(route.service_ids) != len(set(route.service_ids)):
                raise ValueError(f"route {route.id}: repeated service is unsupported")
        for stream in self.demand:
            if stream.origin_id not in origins or stream.route_id not in routes:
                raise ValueError(f"demand {stream.id}: unknown origin or route")
            if stream.end_s > self.horizon_s:
                raise ValueError(f"demand {stream.id}: arrivals exceed simulation horizon")
        if sum(s.count for s in self.demand) > 750:
            raise ValueError("total demand exceeds 750 visitors")
        for label, value in (
            ("sample_interval_s", self.sample_interval_s),
            ("horizon_s", self.horizon_s),
        ):
            ratio = value / self.dt_s
            if abs(ratio - round(ratio)) > 1e-7:
                raise ValueError(f"{label} must be an integer multiple of dt_s")
        return self


def canonical_hash(value) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode()).hexdigest()
