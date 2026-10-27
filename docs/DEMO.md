# Local demonstration

Install dependencies and start the local application using README setup commands. Open http://127.0.0.1:8765. No external API is used at runtime. Static preview can demonstrate saved results when the Python service is unavailable; a fully cached offline install is not provided.

1. Choose **Start planning** and name the event “Synthetic community Puja”. Keep 500 visitors and the baseline plan. This is a synthetic demonstration venue, not a surveyed site.
2. Inspect **Visitor Arrivals**: default 350 allocated visitors in the first 3 minutes and 150 over the following 7. Counts follow the backend’s group allocation. Change settings to see the preview update; load saved baseline to restore the saved fixture inputs.
3. Load the baseline saved result, or choose **Run local simulation**. In **Understand Your Simulation**, read actual completion, unfinished demand, outside waiting and monitored zone measurements. Use replay controls; displayed counters refer to the held replay frame.
4. **Pin reference**, select **Additional exit**, then **Load saved additional exit**. Read **Plan Comparison** and use **Compare maps**. The intervention changes gate geometry and assigned routes. Per-zone exposure can increase as well as decrease; no overall winning plan is asserted.
5. In **Accessibility Inspection**, choose **Start new / reset inspection** for the current event/layout. Identify a route and enter **1.2** in the dedicated aisle field. Its finding requires review against the guide’s separate 1.5 m aisle provision. Other conditions remain uninspected; a simulated exit is not a surveyed accessible entrance.
6. Optionally set step-free access to No and add notes. Export inspection JSON to retain the record; importing it after event/gate changes displays a context review warning.
7. In **Planning Report**, download HTML. Confirm event name, 500 expected visitors, selected scenario hash, actual measurements, pinned comparison, 1.2 m aisle finding, source sections, checklist and limitations. Print to PDF using the browser if desired.

Automated Chromium coverage performs this journey and verifies the downloaded HTML against the selected replay. Separate workflows test a fresh 500-person run, cancellation, late results, horizon-limited output, malformed imports, offline API and narrow screens. No demonstration outcome is represented as measured field performance.

## Demonstrate Crowd Patterns

After loading the baseline, open **Crowd Patterns**. Use **Monitored zone** to inspect Service Queue or Junction. Enter **181** in **Exact crowd observation time**: the analytical observation is at 181 s while the held pedestrian frame is at 180 s. Click a density timeline or a heatmap cell to move the same replay cursor. Select a review card to inspect the zone supporting that finding.

Switch **Crowding map measurement** between current density and whole-run summaries. Notice that map fills isolate one monitored region, and aggregate modes omit pedestrian snapshots. The heatmap shows which regions remain concentrated over time. The population graphs separate inside population, its queue/service subsets, outside waiting, future arrivals and completed journeys.

Pin baseline, load the additional-exit example, then return to Crowd Patterns. Inspect both zone maps and the overlaid density/speed curves on common axes. Change **Compare zone measurement** to exposure, peak sampled density or low-speed duration. Some regions can worsen while others improve; an asterisk marks a changed measurement area.

Download the zone CSV and the planning report. The report contains self-contained SVG charts, original data tables and an embedded CSV. These are synthetic recorded observations, not accident probabilities or field-validated predictions.
