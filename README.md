# Pathway

Pedestrian simulation and scenario comparison for small Indian events, starting with a Puja/pandal venue.

The simulation kernel supports timed arrivals, outside waiting, service queues, geometry validation, directional flow and density measurements. The Puja template includes two entrances, three service lanes and alternative departure arrangements. The browser workspace supports local fresh runs, saved replay, input editing, comparison and report downloads.

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

## Compare event plans

```sh
.venv/bin/pathway puja --variant baseline --count 500 --output runs/puja.json
.venv/bin/pathway compare --counts 500 --seeds 0 1 2 --workers 3 --output runs/comparison
```

The comparison runs the baseline, an additional exit with assigned routes, and staggered arrivals. Visitors retain the same sampled walking speeds and service durations. Reports include per-zone changes, unfinished visitors and arrival-time shifts; generated JSON/CSV files stay in the selected output directory. Reuse verified completed run files with `--resume` and otherwise identical inputs. Failed or cancelled runs remain explicitly reported rather than retried silently.

Optional `--settings file.json` accepts gate widths, arrival windows, service/walking-speed ranges, timestep and horizon. The default full study uses 250/500/750 visitors and ten seeds. A second exit is a combined layout/routing intervention; staggered arrivals change scheduling, with off-site costs outside the model.

The 750-person burst can take several minutes per run. Use `--wall-timeout 600` for the full study on a development laptop; a wall timeout retains partial results and differs from reaching the simulation horizon. Audit exports and generate local charts with:

```sh
.venv/bin/python scripts/audit_study.py runs/comparison --deep
MPLCONFIGDIR=/tmp/pathway-mpl .venv/bin/python scripts/plot_puja.py --study runs/comparison --output runs/charts
```

## Browser workspace

Requires Node.js 22.12+ and the Python environment above. Tested with Node 26.12.

```sh
npm ci --prefix web
npm run build --prefix web
.venv/bin/python -m pathway.server
```

Open [the local workspace](http://127.0.0.1:8765). It starts with a labelled saved 500-person example. Edit inputs and choose **Run local simulation** for a fresh result. **Pin reference** or **Clone scenario** keeps a result for comparison; reports, replay files and scenario JSON can be downloaded. Editing inputs clears the active results until a matching run is selected.

The local service listens on loopback only, supervises one simulation process, and bounds pending jobs, runtime and output storage. Run files are retained under ignored `runs/web/`. A cancelled or timed-out run can have partial output; process failures without a sealed replay remain explicitly unavailable. Service restart marks interrupted jobs rather than inventing results. Keep this prototype local; public compute is outside its current scope.

For frontend development, start the Python service with `--dev-origin http://127.0.0.1:5173`, then run `npm run dev --prefix web`. The Vite development server proxies local API requests. For a static replay-only preview, use `npm run preview --prefix web` after building. It supports the three saved examples, comparison and downloads; fresh computation requires the local service. A fully cached offline website and public deployment are separate release work.

Saved demos are compact, synthetic product fixtures from matched 500-person runs. Display positions are sampled every 2 seconds and rounded to 0.001 m; reported measurements retain their original 1-second samples. The replay does not interpolate or recalculate physics. Each file has a SHA256 envelope and includes its original scenario, demand, source and raw-output hashes. A checksum detects changed bytes; it is not an authenticity signature or model validation.

## Tests

```sh
.venv/bin/python -m pytest -q
npm test --prefix web
npm run test:e2e --prefix web
```

Browser tests require Playwright Chromium (`cd web && npx playwright install chromium`) or `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium`. They start the local service if it is unavailable and write artifacts under ignored `runs/`.

## Scope

Coordinates use metres and time uses seconds. The examples are synthetic. Outputs support exploration of assumptions and layouts; they have not been calibrated to a real event. The kernel currently targets Linux.

## License

Original project files are licensed under [MIT](LICENSE). Dependencies and reference material retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
