"""Small synthetic verification scenarios; not calibrated event templates."""

from shapely.geometry import box
from shapely.ops import unary_union

from pathway.schema import Scenario


def ring(shape):
    return [list(p) for p in shape.exterior.coords][:-1]


def fixture(name="corridor", count=20):
    base = {
        "id": name,
        "geometry": {"boundary": ring(box(0, 0, 24, 8))},
        "origins": [{"id": "west", "positions": [[1, 3], [1, 4], [1, 5]]}],
        "exits": [{"id": "east", "polygon": ring(box(22, 2, 23, 6))}],
        "routes": [{"id": "main", "exit_id": "east"}],
        "demand": [
            {
                "id": "west",
                "origin_id": "west",
                "route_id": "main",
                "count": count,
                "start_s": 0,
                "end_s": 10,
            }
        ],
        "zones": [{"id": "upstream", "polygon": ring(box(1, 1, 10, 7))}],
        "lines": [{"id": "departure", "points": [[20, 1], [20, 7]]}],
        "horizon_s": 180,
        "sample_interval_s": 0.5,
    }
    if name == "bottleneck":
        geometry = unary_union([box(0, 0, 20, 20), box(20, 9.4, 24, 10.6), box(24, 0, 32, 20)])
        base.update(
            {
                "geometry": {"boundary": ring(geometry)},
                "origins": [{"id": "west", "positions": [[1, y] for y in range(2, 19, 2)]}],
                "exits": [{"id": "east", "polygon": ring(box(30, 7, 31, 13))}],
                "zones": [{"id": "upstream", "polygon": ring(box(16, 7, 20, 13))}],
                "lines": [{"id": "departure", "points": [[23, 9.4], [23, 10.6]]}],
                "horizon_s": 600,
                "sample_interval_s": 1,
            }
        )
    elif name in {"crossing", "opposing"}:
        geometry = unary_union([box(0, 9, 24, 15), box(9, 0, 15, 24)])
        second = "south" if name == "crossing" else "east_origin"
        second_points = (
            [[10, 1], [12, 1], [14, 1]] if name == "crossing" else [[23, 10], [23, 12], [23, 14]]
        )
        target = box(10, 22, 14, 23) if name == "crossing" else box(0.5, 10, 1.5, 14)
        base.update(
            {
                "geometry": {"boundary": ring(geometry)},
                "origins": [
                    {"id": "west", "positions": [[1, 10], [1, 12], [1, 14]]},
                    {"id": second, "positions": second_points},
                ],
                "exits": [
                    {"id": "east", "polygon": ring(box(22, 10, 23, 14))},
                    {"id": "second", "polygon": ring(target)},
                ],
                "routes": [
                    {"id": "main", "exit_id": "east"},
                    {"id": "second", "exit_id": "second"},
                ],
                "demand": [
                    {
                        "id": "west",
                        "origin_id": "west",
                        "route_id": "main",
                        "count": count // 2,
                        "end_s": 5,
                    },
                    {
                        "id": second,
                        "origin_id": second,
                        "route_id": "second",
                        "count": count - count // 2,
                        "end_s": 5,
                    },
                ],
                "zones": [{"id": "intersection", "polygon": ring(box(9, 9, 15, 15))}],
                "lines": [{"id": "centre", "points": [[12, 9], [12, 15]]}],
            }
        )
    elif name == "service":
        base["services"] = [
            {
                "id": "darshan",
                "positions": [[14, 4], [13, 4], [12, 4], [11, 4]],
                "duration_s": [2, 3],
            }
        ]
        base["routes"][0]["service_ids"] = ["darshan"]
        base["horizon_s"] = 300
    elif name != "corridor":
        raise ValueError(f"unknown fixture {name}")
    return Scenario.model_validate(base)
