# Pathway

Pedestrian simulation and scenario comparison for small Indian events, starting with a Puja/pandal venue.

The current simulation kernel supports timed arrivals, outside waiting, service queues, geometry validation, directional flow and density measurements. It exports trajectories, visitor records and reproducible run manifests. The event comparison interface is under development.

## Setup

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

```sh
uv sync --locked --extra dev --extra analysis
```

## Run

```sh
.venv/bin/pathway validate examples/fixtures/service.json
.venv/bin/pathway run examples/fixtures/service.json --output runs/my-event
.venv/bin/python scripts/audit_run.py runs/my-event
```

Use a new output directory for each run. Available fixtures include a corridor, bottleneck, crossing flows, opposing flows and a service queue. Export the input format with:

```sh
.venv/bin/pathway schema --output runs/scenario.schema.json
```

Each run includes scenario inputs, generated demand, trajectories, population counts, zone measurements, line crossings and visitor timings. `manifest.json` records completion status, versions and file hashes. Interrupted and unfinished runs retain partial results.

## Tests

```sh
.venv/bin/python -m pytest -q
```

## Scope

Coordinates use metres and time uses seconds. The examples are synthetic. Outputs support exploration of assumptions and layouts; they have not been calibrated to a real event. The kernel currently targets Linux.

## License

Original project files are licensed under [MIT](LICENSE). Dependencies and reference material retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
