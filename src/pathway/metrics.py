"""Measurement definitions independent of JuPedSim and the renderer."""

import math

from shapely.geometry import LineString, Point, Polygon


def zone_measurement(polygon: Polygon, positions, speeds):
    """Boundary points count as inside; speed is a displacement over the last engine step."""
    included = [key for key, point in positions.items() if polygon.covers(Point(point))]
    measured = [speeds[key] for key in included if speeds.get(key) is not None]
    return {
        "count": len(included),
        "usable_area_m2": polygon.area,
        "density_per_m2": len(included) / polygon.area,
        "mean_speed_m_s": sum(measured) / len(measured) if measured else None,
    }


class CrossingCounter:
    """Count finite-segment crossings, retaining the last off-line side across touches.

    Positive means right-to-left of the oriented A→B line (negative to positive
    cross product). Recrossings count again in their respective direction.
    """

    def __init__(self, points):
        self.a, self.b = points
        self.line = LineString(points)
        self.last_off_line = {}
        self.positive = 0
        self.negative = 0

    def observe(self, positions, now_s):
        events = []
        for key, point in positions.items():
            side = (self.b[0] - self.a[0]) * (point[1] - self.a[1]) - (self.b[1] - self.a[1]) * (
                point[0] - self.a[0]
            )
            if abs(side) < 1e-9:
                continue
            previous = self.last_off_line.get(key)
            if previous is not None:
                old_point, old_side, old_time = previous
                if side * old_side < 0 and LineString([old_point, point]).intersects(self.line):
                    direction = "positive" if side > 0 else "negative"
                    setattr(self, direction, getattr(self, direction) + 1)
                    fraction = abs(old_side) / (abs(old_side) + abs(side))
                    events.append(
                        {
                            "visitor_id": key,
                            "direction": direction,
                            "time_s": old_time + fraction * (now_s - old_time),
                            "from_time_s": old_time,
                            "to_time_s": now_s,
                            "from_xy": old_point,
                            "to_xy": point,
                        }
                    )
            self.last_off_line[key] = (point, side, now_s)
        # Removed visitors cannot return. Keep touching agents' prior off-line state.
        for key in self.last_off_line.keys() - positions.keys():
            del self.last_off_line[key]
        return events


def distribution(values):
    """Linear-interpolated quantiles; callers must report the censored population."""
    values = sorted(values)
    if not values:
        return {"count": 0, "mean_s": None, "median_s": None, "p95_s": None}

    def quantile(q):
        index = (len(values) - 1) * q
        low = math.floor(index)
        high = math.ceil(index)
        return values[low] + (values[high] - values[low]) * (index - low)

    return {
        "count": len(values),
        "mean_s": sum(values) / len(values),
        "median_s": quantile(0.5),
        "p95_s": quantile(0.95),
    }
