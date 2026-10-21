import math

import pytest
from pydantic import ValidationError
from shapely.geometry import box

from pathway.demand import demand_hash, generate_demand
from pathway.fixtures import fixture, ring
from pathway.geometry import GeometryError, validate_geometry
from pathway.schema import Scenario, canonical_hash


def change(scenario, **updates):
    return Scenario.model_validate(scenario.model_dump() | updates)


@pytest.mark.parametrize("name", ["corridor", "bottleneck", "crossing", "opposing", "service"])
def test_valid_fixtures_and_roundtrip(name):
    scenario = fixture(name)
    assert validate_geometry(scenario).area > 0
    assert Scenario.model_validate_json(scenario.model_dump_json()) == scenario
    assert canonical_hash(scenario) == canonical_hash(scenario.model_dump(mode="json"))


@pytest.mark.parametrize(
    "updates",
    [
        {"dt_s": math.nan},
        {"dt_s": -1},
        {"sample_interval_s": 0.015},
        {"horizon_s": 10.005},
        {"units": "degrees"},
        {"unknown": True},
        {"seed": True},
    ],
)
def test_reject_bad_settings(updates):
    with pytest.raises(ValidationError):
        change(fixture(), **updates)


def test_bad_references_and_excess_demand():
    s = fixture()
    with pytest.raises(ValidationError, match="unknown exit"):
        change(s, routes=[{"id": "main", "exit_id": "missing"}])
    with pytest.raises(ValidationError):
        fixture(count=751)
    with pytest.raises(ValidationError, match="duplicate"):
        change(s, origins=s.origins * 2)
    with pytest.raises(ValidationError, match="arrivals exceed"):
        change(s, horizon_s=5)


@pytest.mark.parametrize(
    "geometry",
    [
        {"boundary": [[0, 0], [10, 10], [0, 10], [10, 0]]},
        {"boundary": ring(box(0, 0, 24, 8)), "obstacles": [ring(box(0, 1, 3, 4))]},
        {
            "boundary": [
                [0, 0],
                [10, 0],
                [10, 3.9],
                [14, 3.9],
                [14, 0],
                [24, 0],
                [24, 8],
                [14, 8],
                [14, 4.1],
                [10, 4.1],
                [10, 8],
                [0, 8],
            ]
        },
    ],
)
def test_geometry_rejects_self_intersection_touching_obstacle_and_narrow_link(geometry):
    with pytest.raises(GeometryError):
        validate_geometry(change(fixture(), geometry=geometry))


def test_spawn_exit_and_queue_inside_obstacle_rejected():
    s = fixture("service")
    for obstacle in [box(0.5, 2, 2, 6), box(21, 1, 23.5, 7), box(13.5, 3, 14.5, 5)]:
        with pytest.raises(GeometryError):
            validate_geometry(
                change(s, geometry={"boundary": s.geometry.boundary, "obstacles": [ring(obstacle)]})
            )


def test_demand_is_stable_and_independent_of_geometry_order_and_service_rng():
    s = fixture("crossing")
    a = generate_demand(s)
    b = generate_demand(change(s, demand=list(reversed(s.demand))))
    assert a == b
    expanded = change(s, geometry={"boundary": ring(box(-1, -1, 25, 25))})
    assert demand_hash(a) == demand_hash(generate_demand(expanded))
    assert demand_hash(a) != demand_hash(generate_demand(change(s, seed=43)))
    service = fixture("service")
    baseline = generate_demand(service)
    changed = generate_demand(
        change(service, services=[service.services[0].model_dump() | {"duration_s": [10, 20]}])
    )
    assert [(v.arrival_s, v.speed_m_s) for v in baseline] == [
        (v.arrival_s, v.speed_m_s) for v in changed
    ]
