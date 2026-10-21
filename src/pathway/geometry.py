"""Reject invalid geometry; never auto-repair dimensions or route connectivity."""

import jupedsim as jps
from shapely.geometry import LineString, Point, Polygon
from shapely.validation import explain_validity

from pathway.schema import Scenario


class GeometryError(ValueError):
    pass


def polygon(ring, label="polygon"):
    result = Polygon(ring)
    if not result.is_valid or result.area <= 1e-9:
        raise GeometryError(f"{label}: invalid polygon ({explain_validity(result)})")
    return result


def validate_geometry(scenario: Scenario):
    boundary = polygon(scenario.geometry.boundary, "boundary")
    obstacles = [polygon(r, f"obstacle {i}") for i, r in enumerate(scenario.geometry.obstacles)]
    for i, obstacle in enumerate(obstacles):
        if not boundary.contains(obstacle):
            raise GeometryError(f"obstacle {i}: must lie strictly inside boundary")
        if any(obstacle.intersects(other) for other in obstacles[:i]):
            raise GeometryError(f"obstacle {i}: obstacles must not touch or overlap")
    walkable = Polygon(scenario.geometry.boundary, [list(o.exterior.coords) for o in obstacles])
    if not walkable.is_valid or walkable.geom_type != "Polygon":
        raise GeometryError("walkable region must be one valid connected polygon")
    # Conservative body-centre connectivity: a finite disc must fit through the route.
    radius = scenario.model.radius_m
    clearance = walkable.buffer(-radius - 1e-5)
    if clearance.is_empty or clearance.geom_type != "Polygon":
        raise GeometryError("walkable area disconnects or disappears at the configured body radius")
    origin_points = {}
    for origin in scenario.origins:
        for p in origin.positions:
            if not clearance.contains(Point(p)):
                raise GeometryError(f"origin {origin.id}: spawn point lacks body clearance")
        origin_points[origin.id] = origin.positions
    exit_points = {}
    for exit_ in scenario.exits:
        area = polygon(exit_.polygon, f"exit {exit_.id}")
        if not walkable.covers(area):
            raise GeometryError(f"exit {exit_.id}: must lie within the walkable region")
        target = area.intersection(clearance)
        if target.is_empty or target.area <= 1e-9:
            raise GeometryError(f"exit {exit_.id}: no reachable body-centre space")
        exit_points[exit_.id] = tuple(target.representative_point().coords)[0]
    for service in scenario.services:
        for p in service.positions:
            if not clearance.contains(Point(p)):
                raise GeometryError(f"service {service.id}: queue point lacks body clearance")
        for a, b in zip(service.positions, service.positions[1:]):
            if not clearance.covers(LineString([a, b])):
                raise GeometryError(f"service {service.id}: queue passes through a wall")
            if Point(a).distance(Point(b)) < 2 * radius:
                raise GeometryError(f"service {service.id}: queue points overlap body diameter")
    for zone in scenario.zones:
        area = polygon(zone.polygon, f"zone {zone.id}")
        if area.intersection(walkable).area <= 1e-9:
            raise GeometryError(f"zone {zone.id}: no usable measurement area")
    for line in scenario.lines:
        segment = LineString(line.points)
        if segment.length <= 1e-9 or not walkable.covers(segment):
            raise GeometryError(f"line {line.id}: must be nonzero and inside walkable space")
    try:
        router = jps.RoutingEngine(geometry=walkable)
        services = {s.id: s for s in scenario.services}
        routes = {r.id: r for r in scenario.routes}
        for stream in scenario.demand:
            route = routes[stream.route_id]
            via = [services[s].positions[-1] for s in route.service_ids]
            via.append(exit_points[route.exit_id])
            for start in origin_points[stream.origin_id]:
                points = [start, *via]
                for a, b in zip(points, points[1:]):
                    if not router.compute_waypoints(a, b):
                        raise GeometryError(f"route {route.id}: no engine path from {a} to {b}")
    except RuntimeError as exc:
        raise GeometryError(f"engine cannot route this geometry: {exc}") from exc
    return walkable
