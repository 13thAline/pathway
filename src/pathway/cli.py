"""Local CLI: validate inputs, run fresh simulations and export raw evidence."""

import argparse
import json
import sys
from pathlib import Path

from pathway.fixtures import fixture
from pathway.geometry import validate_geometry
from pathway.output import write_json
from pathway.runner import run_scenario
from pathway.schema import Scenario, canonical_hash


def main(argv=None):
    parser = argparse.ArgumentParser(prog="pathway")
    commands = parser.add_subparsers(dest="command", required=True)
    example = commands.add_parser("example", help="write a synthetic verification fixture")
    example.add_argument(
        "name", choices=["corridor", "bottleneck", "crossing", "opposing", "service"]
    )
    example.add_argument("--count", type=int, default=20)
    example.add_argument("--output", type=Path, required=True)
    schema = commands.add_parser("schema", help="export the versioned input JSON schema")
    schema.add_argument("--output", type=Path, required=True)
    validate = commands.add_parser("validate", help="validate scenario and pedestrian geometry")
    validate.add_argument("scenario", type=Path)
    run = commands.add_parser("run", help="run the actual pedestrian engine")
    run.add_argument("scenario", type=Path)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--wall-timeout", type=float, default=120)
    args = parser.parse_args(argv)
    try:
        if args.command in {"example", "schema"}:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            if args.command == "schema":
                value = Scenario.model_json_schema()
            else:
                value = fixture(args.name, args.count).model_dump(mode="json")
            write_json(args.output, value)
            print(args.output)
            return 0
        scenario = Scenario.model_validate_json(args.scenario.read_text())
        if args.command == "validate":
            geometry = validate_geometry(scenario)
            print(
                json.dumps(
                    {
                        "status": "valid",
                        "scenario_sha256": canonical_hash(scenario),
                        "usable_area_m2": geometry.area,
                        "visitors": sum(s.count for s in scenario.demand),
                    }
                )
            )
            return 0
        result = run_scenario(scenario, args.output, wall_timeout_s=args.wall_timeout)
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "output": str(args.output),
                    "population": result["population"],
                    "wall_time_s": result["wall_time_s"],
                    "error": result["error"],
                }
            )
        )
        return 0 if result["status"] in {"succeeded", "horizon_reached"} else 1
    except (ValueError, OSError) as exc:
        print(f"pathway: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
