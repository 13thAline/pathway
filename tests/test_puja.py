from dataclasses import asdict

import pytest

from pathway.comparison import check_pairing
from pathway.demand import generate_demand
from pathway.geometry import validate_geometry
from pathway.puja import VARIANTS, PujaSettings, puja_scenario


@pytest.mark.parametrize("count", [1, 30, 250, 500, 750])
def test_venue_and_matched_visitors(count):
    scenarios = {variant: puja_scenario(variant, count) for variant in VARIANTS}
    for scenario in scenarios.values():
        assert validate_geometry(scenario).is_valid
        assert sum(stream.count for stream in scenario.demand) == count
    check_pairing(scenarios)
    populations = {
        variant: {v.id: asdict(v) for v in generate_demand(s)} for variant, s in scenarios.items()
    }
    assert populations["baseline"] == populations["second_exit"]
    for key, visitor in populations["baseline"].items():
        alternate = populations["staggered"][key]
        assert {k: v for k, v in visitor.items() if k != "arrival_s"} == {
            k: v for k, v in alternate.items() if k != "arrival_s"
        }
    if count == 500:
        a = sum(v["origin_id"] == "A" for v in populations["baseline"].values())
        assert a == 300
        assert count - a == 200
    assert set(r.exit_id for r in scenarios["baseline"].routes) == {"main"}
    assert set(r.exit_id for r in scenarios["second_exit"].routes) == {"main", "second"}


def test_closed_main_gate_has_explicit_rerouting_or_rejection():
    settings = PujaSettings(main_gate_width_m=0)
    with pytest.raises(ValueError, match="no open"):
        puja_scenario("baseline", settings=settings)
    diverted = puja_scenario("second_exit", settings=settings)
    assert validate_geometry(diverted).is_valid
    assert {r.exit_id for r in diverted.routes} == {"second"}


@pytest.mark.parametrize("count", [-1, 0, 751, True, 2.5])
def test_reject_invalid_populations(count):
    with pytest.raises(ValueError):
        puja_scenario(count=count)


def test_pairing_rejects_unmatched_service_assumptions():
    scenarios = {variant: puja_scenario(variant, 6) for variant in VARIANTS}
    scenarios["second_exit"] = puja_scenario("second_exit", 6, settings={"service_s": [5, 10]})
    with pytest.raises(ValueError, match="unmatched"):
        check_pairing(scenarios)
