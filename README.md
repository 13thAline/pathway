# Pathway

**Intelligent Event Flow and Accessibility Planning**, built on JuPedSim pedestrian simulation. Local decision support for small community events in India, starting with a synthetic Puja/pandal venue.

The simulation kernel supports timed arrivals, outside waiting, service queues, geometry validation, directional flow and density measurements. The Puja template includes two entrances, three service lanes and alternative departure arrangements. The browser workspace supports local fresh runs, saved replay, input editing, comparison and report downloads.

The name **Pathway** means more than a route: it represents finding a practical way through a planning problem by comparing assumptions and alternatives. **Find a better way through.**

## Purpose and Sustainable Development Goals

Pathway helps community organizers discuss visitor movement and physical access together. Its intended contribution aligns with [SDG target 11.7](https://sdgs.un.org/goals/goal11), through attention to accessible public gathering spaces; [target 10.2](https://sdgs.un.org/goals/goal10), through explicit inclusion checks; and [target 16.7](https://sdgs.un.org/goals/goal16), through reports that make planning assumptions and trade-offs available for discussion. This is a project-level interpretation of those targets, not UN endorsement or measured progress against official SDG indicators. Field evaluation and participation by organizers and accessibility users are still needed.

## Repository checklist

| Item | Location |
| --- | --- |
| Setup and environment configuration | [Setup](#setup), [Browser workspace](#browser-workspace), [Configuration and environment variables](#configuration-and-environment-variables) |
| Technical design and architectural diagrams | [Technical design document](docs/ARCHITECTURE.md) |
| Sample data | [Kernel scenarios](examples/fixtures/), [Puja scenarios](examples/puja/), [saved simulation replays](web/public/demos/) |
| Automated tests and verification | [Python tests](tests/), [frontend tests](web/src/), [browser workflows](web/tests/), [verification status](docs/BASELINE_STATUS.md) |
| License and attribution | [MIT license](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md) |
| End-to-end walkthrough | [Demonstration guide](docs/DEMO.md) |

## Setup

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

From a terminal on Linux, clone the repository and run all following commands from its root:

```sh
git clone https://github.com/13thAline/pathway.git
cd pathway
```

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

## Configuration and environment variables

**No environment variables, API keys or `.env` file are required to run the application.** There is no database or external runtime service to configure. Application settings are browser inputs or command-line arguments; the Python service does not load `.env` files.

| Server argument | Default | Purpose |
| --- | --- | --- |
| `--port` | `8765` | Local HTTP port; the service always binds to `127.0.0.1`. |
| `--runs` | `runs/web` | Directory for saved jobs and raw outputs. Use a new directory when retained-job storage is full. |
| `--static` | `web/dist` | Built frontend directory. Run `npm run build --prefix web` first. |
| `--dev-origin` | Unset | Allow `http://127.0.0.1:5173` or `http://localhost:5173` during Vite development. |

The development proxy targets backend port 8765. The browser test service uses its own port 8766; leave that port available when testing.

These optional variables are for testing and analysis; export them in the shell rather than creating a `.env` file:

| Variable | Default when unset | Purpose |
| --- | --- | --- |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Playwright-managed Chromium | Path to an existing Chromium executable for browser tests. |
| `PATHWAY_BROWSER_REPORT` | `../runs/browser-results.json`, relative to `web/` | Browser test JSON report path. An absolute path avoids working-directory ambiguity. |
| `PATHWAY_BROWSER_OUTPUT` | `../runs/browser-tests`, relative to `web/` | Browser test artifact directory. |
| `MPLCONFIGDIR` | Matplotlib's user configuration directory | Optional writable directory for analysis plots or test environments with restricted home-directory access. |

The local supervisor explicitly sets `OMP_NUM_THREADS=1` and `OPENBLAS_NUM_THREADS=1` for simulation children to limit thread use; these are not user-facing tuning controls. Secrets and generated runs are excluded from Git.

## Tests

```sh
.venv/bin/python -m pytest -q
npm test --prefix web
npm run build --prefix web
npm run test:e2e --prefix web
```

Browser tests require Playwright Chromium (`cd web && npx playwright install chromium`) or `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium`. They start an isolated local service on loopback port 8766 with a fresh `runs/e2e/<timestamp>-<process>/` directory per invocation, preserve the normal service on port 8765, and write artifacts under ignored `runs/`.

## Scope

Coordinates use metres and time uses seconds. The examples are synthetic. Outputs support exploration of assumptions and layouts; they have not been calibrated to a real event. The kernel currently targets Linux.

## License

Original project files are licensed under [MIT](LICENSE). Dependencies and reference material retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Pathway planning workflow

Pathway — Intelligent Event Flow and Accessibility Planning — combines an organizer workflow with a reproducible pedestrian simulation engine. No cloud account, payment service or external API is needed.

1. **Event Setup:** enter an optional name, select an event type and describe arrival provenance. Metadata does not change pedestrian physics. The only venue is the synthetic Puja template.
2. **Visitor Arrivals:** configure attendance, peak share and arrival durations in minutes. The preview follows the backend’s integer allocations. Staggered arrivals are uniform across the full period, so segment counts are approximate expectations.
3. **Venue Simulation:** load a labelled saved demonstration or run locally; inspect recorded pedestrian trajectories, completion, waiting and zone measurements. Advanced controls retain seed, gate widths, speeds, service durations, timestep and horizon in engine units.
4. **Plan Comparison:** pin a result, load/run an alternative and compare maps. Matched runs show measured exposure changes, harms in other zones and human review prompts. Incompatible runs show the rejection reason. An additional exit changes both layout and assigned routes; staggering excludes off-site scheduling costs.
5. **Accessibility Inspection:** record measured widths and Yes/No/Not inspected conditions. A blank width is unmeasured; zero is a recorded value. Source-linked checks are separate from walking simulation. Event/layout/gate changes flag the audit for review. Export inspection JSON to keep it between sessions; import validates data. Reset starts a new inspection. Nothing is sent to a cloud service.
6. **Planning Report:** download print-friendly HTML with event assumptions, actual selected-run results, permitted comparisons, separate manual audit, review actions, attribution and limitations. Use browser Print → Save as PDF if needed. Replay and scenario JSON exports remain available.

See [architecture](docs/ARCHITECTURE.md), [baseline and verification status](docs/BASELINE_STATUS.md) and [demonstration guide](docs/DEMO.md).

## Evidence and limitations

The synthetic venue has not been surveyed or calibrated against a real event. Organizer estimates are assumptions; saved and fresh results are simulations, not forecasts. Inspection values are manually reported, optional personal details stay in the page/exported file, and the pedestrian engine does not model wheelchair access. The application provides no safety, capacity, accessibility or evacuation certification and no injury prediction or LOS A–F grading. Local verification and professional judgment remain necessary.

The inspection rules reference [UN India, UNESCO and IIT Kharagpur’s 2025 Durga Puja accessibility guide](https://india.un.org/sites/default/files/2025-10/English%20SOP%20.pdf): entrance §2.3, internal circulation §2.4, resting/seating §2.6 and signage §2.8. The app checks selected observations; the complete document contains further contextual requirements, including ramps, pinch points, handrails, surfaces, support facilities and volunteer preparation. The guide is linked rather than bundled.

Research concepts and poster attribution supplied by the project owner: Anuj Nautiyal and Dr. Amit Agarwal (IIT Roorkee), *Transforming Registration Data into Activity-Based Travel Demand: A Reproducible Framework for Planning Large-Scale Pilgrimage Mobility*; Ashish Ranjan (SPA Bhopal), *Regulated versus Unregulated Pedestrian Flow at a Mega-Pilgrimage Node: A LOS Analysis of the Mahakaleshwar Temple Precinct, Ujjain*. Conference attribution has not been independently verified. Pathway uses simplified arrival scenarios and existing movement measurements; it does not reproduce those studies.

Implemented P0 includes local event setup, arrival preview, simulation/replay, valid plan comparison, deterministic explanations, explicit inspection JSON persistence and integrated HTML reporting. Existing CLI repeated studies remain available. P1 browser CSV schedules, repeated-study controls, validated comfort interpretation and field calibration are future work. P2 surveyed venue editing, mobility-specific route analysis, localization and mobile/offline inspection are future work. No achieved social-impact statistics are claimed; future evaluation could measure setup time, comprehension, inspection issues found and agreement with observed counts after calibration.

## Crowd Patterns dashboard

**Crowd Patterns** turns the recorded simulation measurements into interactive evidence:

- Select a monitored zone using the map or keyboard-accessible selector. Read its sampled density and mean movement speed, and move the shared replay cursor by clicking a graph, using the time slider or entering exact seconds.
- Switch the map between current sampled density, peak density, accumulated person-seconds and occupied low-speed duration. Only one zone is filled because measurement zones overlap. The map shows a zone average, not a smooth local-density surface. Whole-run modes describe different times, not simultaneous occupancy.
- Inspect the zone-by-time density heatmap. Each window retains its maximum recorded sample; tooltips include time and sample count. Missing windows are grey. Coloured windows can contain missing observations, so inspect the original table or CSV for coverage.
- View separate population and arrival/completion graphs. Queued and in-service people are subsets of inside population and must not be added to it. Observed arrivals includes people waiting outside; it is not admissions.
- Pin a compatible reference to see shared-scale density/speed curves, paired maps and comparison bars for exposure, density, low-speed duration, completion and outside waiting. Changed measurement areas and actual run ends remain visible. Failed or incompatible pairs do not produce comparison charts.
- Download original zone measurements as CSV, or download the planning HTML report with embedded SVG charts, data tables and an embedded CSV download. Full original sample tables are retained in the HTML and omitted from print; charts and summary evidence remain printable.

Analytical samples retain their original cadence (normally 1 s); held display frames are normally 2 s. Null speed, gaps and observation ends are not filled with invented zero values. Imported analytical samples are validated before display. Low-speed shading uses the threshold recorded by that run, currently 0.3 m/s in the supplied demonstrations, as a diagnostic only. Service waiting may explain low speeds. Colour scales are relative to the displayed runs and do not classify danger. The dashboard does not calculate accident likelihood or an overall safety score.

Gate-flow timelines, fine spatial density grids and repeated-seed charts remain separate future work; the first dashboard uses existing saved and fresh replay measurements without changing the engine or replay format.

Crowd review cards also identify the largest recorded exposure increase and decrease in a compatible alternative. Selecting a card opens its supporting zone and matching map measurement. These are individual trade-offs, not an overall ranking.
