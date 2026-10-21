"""Local CLI: validate inputs, run fresh simulations and export raw evidence."""

import argparse
import json
import sys
from pathlib import Path

from pathway.fixtures import fixture
from pathway.geometry import validate_geometry
from pathway.output import write_json
from pathway.puja import VARIANTS, PujaSettings, puja_scenario
from pathway.runner import run_scenario
from pathway.schema import Scenario, canonical_hash
from pathway.study import run_study


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
    puja = commands.add_parser("puja", help="write a synthetic Puja event scenario")
    puja.add_argument("--variant", choices=VARIANTS, default="baseline")
    puja.add_argument("--count", type=int, default=500)
    puja.add_argument("--seed", type=int, default=42)
    puja.add_argument("--settings", type=Path)
    puja.add_argument("--output", type=Path, required=True)
    compare = commands.add_parser("compare", help="run matched Puja scenario comparisons")
    compare.add_argument("--counts", type=int, nargs="+", default=[250, 500, 750])
    compare.add_argument("--seeds", type=int, nargs="+", default=list(range(10)))
    compare.add_argument("--workers", type=int, default=1)
    compare.add_argument("--settings", type=Path)
    compare.add_argument("--wall-timeout", type=float, default=180)
    compare.add_argument("--resume", action="store_true")
    compare.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command in {"puja", "compare"}:
            config = (
                PujaSettings.model_validate_json(args.settings.read_text())
                if args.settings
                else PujaSettings()
            )
            if args.command == "puja":
                scenario = puja_scenario(args.variant, args.count, args.seed, config)
                validate_geometry(scenario)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                write_json(args.output, scenario.model_dump(mode="json"))
                print(args.output)
                return 0

            def progress(done, total, record):
                count, seed, variant = record["key"]
                print(
                    f"{done}/{total} n={count} seed={seed} {variant}: "
                    f"{record['summary']['status']}",
                    flush=True,
                )

            result = run_study(
                args.output,
                counts=args.counts,
                seeds=args.seeds,
                workers=args.workers,
                settings=config,
                resume=args.resume,
                wall_timeout_s=args.wall_timeout,
                progress=progress,
            )
            print(
                json.dumps(
                    {
                        "output": str(args.output),
                        "runs": result["requested_runs"],
                        "execution_failures": result["execution_failures"],
                    }
                )
            )
            return 1 if result["execution_failures"] else 0
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
    except KeyboardInterrupt:
        print("pathway: study cancelled; partial run files retained", file=sys.stderr)
        return 130
    except (ValueError, OSError) as exc:
        print(f"pathway: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
