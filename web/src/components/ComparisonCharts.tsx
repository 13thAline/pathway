import {
  populationComparisonRows,
  comparisonMetrics,
  comparisonRows,
  type ComparisonMetric,
} from "../analyticsComparison";
import { useState } from "react";
import type { Loaded } from "../types";
import { comparisonReason } from "../model";
import { numberLabel } from "../analytics";
import { barsSvg } from "../chartSvg";
import { ChartLegend } from "./AnalyticsCharts";
export function ComparisonCharts({
  selected,
  reference,
}: {
  selected: Loaded;
  reference: Loaded | null;
}) {
  const [metric, setMetric] = useState<ComparisonMetric>("sampled_person_s");
  const reason = reference
    ? comparisonReason(reference.replay.summary, selected.replay.summary)
    : "Pin a compatible reference to compare charts.";
  if (reason || !reference)
    return (
      <section aria-label="Crowd chart comparison">
        <h3>Scenario comparison charts</h3>
        <p>{reason}</p>
      </section>
    );
  const rows = comparisonRows(selected, reference, metric),
    definition = comparisonMetrics[metric];
  const populations = populationComparisonRows(selected, reference);
  return (
    <section aria-label="Crowd chart comparison">
      <h3>Scenario comparison charts</h3>
      <label>
        Compare zone measurement
        <select
          aria-label="Compare zone measurement"
          className="field"
          value={metric}
          onChange={(e) => setMetric(e.target.value as ComparisonMetric)}
        >
          {Object.entries(comparisonMetrics).map(([id, d]) => (
            <option key={id} value={id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <ChartLegend
        series={[
          { name: "Pinned reference", color: "#147d92" },
          { name: "Selected plan", color: "#6d28d9" },
        ]}
      />
      <div
        className="chart-scroll"
        dangerouslySetInnerHTML={{
          __html: barsSvg(rows, definition.label, definition.unit),
        }}
      />
      <p>
        * Usable area changed; density denominators differ. These are separate
        observations of one seed, not a combined score. Low-speed duration uses
        each run’s recorded diagnostic threshold. Actual recorded ends: pinned{" "}
        {numberLabel(reference.replay.summary.simulated_time_s)} s; selected{" "}
        {numberLabel(selected.replay.summary.simulated_time_s)} s.
      </p>
      <div
        className="chart-scroll"
        dangerouslySetInnerHTML={{
          __html: barsSvg(
            populations,
            "Completion and outside waiting",
            "people",
          ),
        }}
      />
      <details>
        <summary>Comparison chart values</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Pinned ({definition.unit})</th>
                <th>Selected ({definition.unit})</th>
                <th>Selected − pinned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th>
                    {r.label}
                    {r.changedArea ? " *" : ""}
                  </th>
                  <td>{numberLabel(r.reference)}</td>
                  <td>{numberLabel(r.selected)}</td>
                  <td>
                    {r.reference != null && r.selected != null
                      ? numberLabel(r.selected - r.reference)
                      : "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
