# Baseline status

Inspected 27 October 2026 before SahajYatra edits, on branch `feat/sahajyatra-p0`. Existing unrelated `.vscode/` files were left untouched.

- Frontend: 8 existing Vitest tests passed; TypeScript/Vite production build passed.
- Python sandbox run: 83 passed, two HTTP integration setup errors because loopback sockets are prohibited. This is an execution-environment restriction; elevated rerun passed: all 85 tests.
- Browser sandbox run: service could not bind a loopback socket. Elevated rerun passed: all 7 workflows, including a fresh 500-person run.
- Existing Python and browser environments are present; dependency versions were read from project manifests and locks, rather than upgraded.

## Observations

Working functionality includes seeded scenarios, local job supervision, saved/fresh/imported replay, result invalidation, pinned comparisons, partial status handling and HTML/JSON exports. App.tsx contains 1,378 lines; new product logic should be modular. Saved fixtures are 500 visitors/seed 0. Gate changes and assigned routes are one intervention. Staggering uses the whole arrival window. Arrival rounding occurs within each route group, so a single aggregate rounded percentage is insufficient.

The venue is synthetic and fixed-size; no field calibration, wheelchair movement model, LOS classification, injury model, evacuation certification, CSV schedule import or surveyed venue editor exists. Horizon-limited results retain censored visitors. Sparse zone samples do not justify a continuous heatmap. Public deployment and fully cached offline use remain outside P0.

Final verification is recorded below after implementation.

## Final P0 verification — 27 October 2026

- `uv sync --locked --extra dev --extra analysis`: passed; locked Python environment checked.
- `npm ci --prefix web`: passed; 67 packages installed, npm reported zero vulnerabilities.
- `MPLCONFIGDIR=/tmp/pathway-mpl .venv/bin/python -m pytest -q`: **86 passed**. This includes the existing validation, geometry, demand, comparison, runner, export, CLI and HTTP tests, plus a browser/backend arrival allocation contract check.
- `npm test --prefix web`: **86 passed** across four files. Coverage includes 56 backend allocation cases, percentages/minutes, staggered expectations, invalid arrival inputs, accessibility thresholds/missing/invalid values, source references, three-state observations, JSON round-trips, stale context, actual-fixture decisions and report escaping.
- `npm run build --prefix web`: passed TypeScript and Vite production build.
- `npm run test:e2e --prefix web`: **9 passed** in 48.2 s. All seven original workflows remain, with the horizon test updated to enter organizer minutes. Added full planning/inspection/report download and mobile/keyboard/invalid-measurement workflows.
- Ruff, Prettier and `git diff --check`: passed.
- Desktop and narrow-screen screenshots inspected. Exported HTML opened in Chromium and printed to A4 PDF; no script elements or horizontal overflow. Generated artifacts remain local, outside public source.

Earlier attempts exposed implicit field labels containing helper/option text; explicit accessible names fixed the two new browser workflows. No product failures remain in the final suite. Sandbox-only loopback failures were resolved by running the integration checks with socket access. No claim of field validation follows from these tests.

## Delivered files and module responsibilities

New:

- `docs/ARCHITECTURE.md`, `docs/BASELINE_STATUS.md`, `docs/DEMO.md`: implementation, verification and demo usage.
- `web/src/planning.ts`: event metadata and inspection context identity.
- `web/src/arrivals.ts`, `web/src/arrivals.test.ts`, `web/src/fixtures/arrival-allocation.json`: unit conversion and engine-consistent arrival preview contracts.
- `web/src/accessibility.ts`, `web/src/accessibility.test.ts`: versioned inspection records, import validation and source-backed pure findings.
- `web/src/decision.ts`, `web/src/decision.test.ts`: permitted comparison interpretations, tradeoffs and report integration checks using real saved results.
- `web/src/planningReport.ts`: separate event/audit evidence and organizer report sections.
- `web/src/components/{EventSetup,ArrivalPreview,AccessibilityAudit,DecisionSummary,ReportPanel}.tsx`: organizer workflow sections.
- `web/tests/planning.spec.ts`: complete demonstration, inspection persistence, invalid inputs and keyboard/mobile checks.

Changed:

- `web/src/App.tsx`: section navigation, beginner/advanced controls, organizer metadata, results explanations and component integration.
- `web/src/model.ts`: backward-compatible report extension with optional planning evidence and readable metric units; existing hashes/exports remain.
- `web/src/style.css`, `web/index.html`: product branding, readable sections, responsive inspection/chart styling and focus/print support.
- `web/tests/workspace.spec.ts`: existing horizon workflow enters minutes and opens renamed advanced controls.
- `tests/test_puja.py`: verifies browser arrival vectors against actual backend scenario generation for all three variants.
- `README.md`, `THIRD_PARTY_NOTICES.md`: setup, features, evidence boundaries, references and future scope.
- `.gitignore`: permits only the three explicitly requested public documents while retaining exclusions for internal documentation.

No changes to `src/pathway/`, simulation schemas, API contracts, raw output formats, saved demonstrations or dependency manifests/locks. No new runtime dependency. The implementation was verified on `feat/sahajyatra-p0` before publication. Existing unrelated `.vscode/` files remain untouched.

## Remaining capabilities

P0 is implemented and verified for the local synthetic venue. P1 browser CSV demand, repeated-study controls, validated LOS/comfort interpretation and field calibration are unimplemented; existing CLI repeated studies still work. P2 surveyed venue editing, mobility-specific route analysis, localization and mobile/offline extensions are unimplemented. Public hosting and fully cached offline installation are outside this delivery. Inspection persistence uses explicit validated JSON import/export; reload without exporting loses in-page edits. Reports retain stale audit warnings and do not certify safety, compliance or wheelchair accessibility.

## Crowd Patterns extension — 27 October 2026

Added `web/src/analytics.ts`, `chartSvg.ts`, `analyticsComparison.ts`, `analyticsReport.ts`, `analytics.test.ts`, `components/{CrowdPatterns,AnalyticsCharts,ComparisonCharts}.tsx` and `web/tests/analytics.spec.ts`. Updated `Venue.tsx` for clipped selected-zone overlays/pointer selection, `App.tsx` for the shared analytics cursor and navigation, `model.ts` for analytical import validation/report charts, and styles/usage documentation. The preceding P0 file inventory remains applicable; these are additional changes on the same local branch.

Implemented synchronized density/speed graphs, population and journey-accounting graphs, a maximum-recorded-density time heatmap, four zone-map modes, compatible shared-scale comparison charts, clickable review findings, accessible original tables, full-precision CSV and self-contained SVG/CSV report exports. No runtime dependencies, engine/API schemas, raw metric definitions or saved fixtures changed. Gate-flow timelines, fine spatial grids and repeated-seed charts remain outside this release. No accident-probability model or safety categories were added.

Analytical replay validation now rejects invalid/duplicate/out-of-order zone records, impossible density/count relationships, unknown zones and invalid queue accounting even with a valid checksum. Missing samples remain valid but unavailable. Curves break over missing values/gaps and stop at actual observation ends. Tests cover hand-calculated geometry-independent data and actual saved exports, missing values, null speed, fractional final samples, empty/zero-time charts, sample-window peaks, comparison rejection, source-linked review cards, export escaping and original CSV precision.

Repeated browser runs exposed test-harness state accumulation: the shared test output directory reached the unchanged 32-job service limit. `web/playwright.config.ts` now creates a fresh timestamp/process directory under `runs/e2e/` for each invocation and uses its own loopback port 8766 without reusing the normal app service. Old results are retained; production execution limits are unchanged. README test instructions reflect the isolated service.

Final extension verification: **86 Python tests**, **115 frontend tests**, and **11 isolated Chromium workflows** passed (61.1 s, no failures/skips/flakes). TypeScript/Vite build, Ruff, Prettier and whitespace checks passed. The default fresh 500-person run completed in the browser regression; its workflow took 36.7 s in the final isolated run. Exported HTML rendered with nine inline SVG charts, no script elements, no horizontal overflow, and an embedded CSV containing all 5,859 selected-run zone samples with original precision. A4 PDF rendering passed; full original sample tables are excluded only from print. Desktop, mobile, density-timeline and zone-time heatmap screenshots were inspected. Internal artifacts and source hashes remain under `.agents/`.

## Publication verification — 27 October 2026

The release check reran all **86 Python tests**, **115 frontend tests** and **11 browser workflows** successfully, together with the production build, Ruff, Prettier and whitespace checks. The fresh 500-person browser workflow took 38.6 s in this run; it is a measured test duration, not a runtime guarantee. Application source hashes match the preceding visual analytics verification. README now indexes the submission checklist and documents actual optional environment variables; the technical design includes component and request-lifecycle diagrams, HTTP contracts and execution limits. Samples and the MIT license are included. Private working documents and generated presentation artifacts remain excluded.
