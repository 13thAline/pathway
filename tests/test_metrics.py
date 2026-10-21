import pytest
from shapely.geometry import Polygon, box

from pathway.metrics import CrossingCounter, distribution, zone_measurement


def test_density_uses_usable_area_and_boundary_count():
    area = Polygon(box(0, 0, 4, 4).exterior.coords, [box(1, 1, 3, 3).exterior.coords])
    metric = zone_measurement(
        area, {"a": (0.5, 0.5), "b": (0, 1), "c": (2, 2)}, {"a": 1, "b": 2, "c": 3}
    )
    assert metric == {
        "count": 2,
        "usable_area_m2": 12,
        "density_per_m2": 2 / 12,
        "mean_speed_m_s": 1.5,
    }
    assert zone_measurement(area, {}, {})["mean_speed_m_s"] is None


def test_crossings_touch_recross_and_finite_segment():
    counter = CrossingCounter(((0, 0), (0, 2)))
    assert not counter.observe({"a": (-1, 1)}, 0)
    assert not counter.observe({"a": (0, 1)}, 1)
    events = counter.observe({"a": (1, 1)}, 2)
    assert events[0]["direction"] == "negative"
    assert events[0]["time_s"] == 1
    assert counter.observe({"a": (-1, 1)}, 3)[0]["direction"] == "positive"
    counter.observe({"b": (-1, 3)}, 4)
    assert not counter.observe({"b": (1, 3)}, 5)
    assert (counter.positive, counter.negative) == (1, 1)


def test_tangent_does_not_count_and_birth_on_line_has_no_direction():
    counter = CrossingCounter(((0, 0), (0, 2)))
    for t, x in enumerate([-1, 0, -1]):
        assert not counter.observe({"a": (x, 1)}, t)
    assert not counter.observe({"b": (0, 1)}, 3)
    assert not counter.observe({"b": (1, 1)}, 4)


def test_distribution_known_values_and_empty():
    assert distribution([])["count"] == 0
    result = distribution([0, 10, 20, 30])
    assert result["median_s"] == 15
    assert result["p95_s"] == pytest.approx(28.5)
