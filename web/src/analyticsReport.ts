import {
  analyticalCsv,
  crowdFindings,
  densityMaximum,
  lowSpeedIntervals,
  numberLabel as n,
  svgEscape as esc,
  zoneLabel,
  zoneSeries,
  type Series,
} from "./analytics";
import { barsSvg, heatmapSvg, lineSvg, type LineSpec } from "./chartSvg";
import { comparisonReason } from "./model";
import {
  exposureFindings,
  populationComparisonRows,
  comparisonMetrics,
  comparisonRows,
} from "./analyticsComparison";
import type { Loaded } from "./types";
/** Static SVG uses the same renderer and recorded series as the interactive dashboard. */
export function analyticsReport(
  current: Loaded,
  reference: Loaded | null,
): string {
  const r = current.replay,
    findings = [
      ...crowdFindings(r),
      ...(reference ? exposureFindings(current, reference) : []),
    ],
    primary = findings[0]?.zone ?? Object.keys(r.summary.zones)[0];
  const compatible =
    reference && !comparisonReason(reference.replay.summary, r.summary)
      ? reference
      : undefined;
  const max = densityMaximum(r, compatible?.replay),
    cadence = r.summary.measurement.sample_interval_s;
  const figure = (spec: LineSpec) =>
    `<figure><figcaption>${esc(spec.title)}</figcaption><p>${spec.series.map((s) => `<span style="color:${esc(s.color)}">${esc(s.name)}${s.dashed ? " (dashed)" : ""}</span>`).join(" · ")}</p>${lineSvg(spec)}</figure>`;
  const rows = primary ? zoneSeries(r, primary) : [];
  const metricSeries = (key: "density" | "speed"): Series[] => [
    {
      name: "Selected plan",
      color: "#6d28d9",
      points: rows.map((row) => ({ t: row.t, value: row[key] })),
    },
    ...(compatible
      ? [
          {
            name: "Pinned reference",
            color: "#147d92",
            dashed: true,
            points: zoneSeries(compatible.replay, primary).map((row) => ({
              t: row.t,
              value: row[key],
            })),
          },
        ]
      : []),
  ];
  const end = Math.max(
    r.summary.simulated_time_s,
    compatible?.replay.summary.simulated_time_s ?? 0,
  );
  const populationSeries: Series[] = [
    ["active", "Inside total", "#6d28d9"],
    ["waiting_outside", "Waiting outside", "#b45309"],
    ["queued", "Queued inside", "#147d92"],
    ["serving", "In service", "#334155"],
  ].map(([key, name, color], i) => ({
    name,
    color,
    dashed: i % 2 === 1,
    points: r.ledger.map((row) => ({
      t: row.time_s,
      value: row[key as keyof typeof row],
    })),
  }));
  const accountingSeries: Series[] = [
    ["future", "Future arrivals", "#b45309"],
    ["scheduled_by_time", "Arrivals observed", "#147d92"],
    ["completed", "Completed journeys", "#6d28d9"],
  ].map(([key, name, color]) => ({
    name,
    color,
    points: r.ledger.map((row) => ({
      t: row.time_s,
      value: row[key as keyof typeof row],
    })),
  }));
  const compared = compatible
    ? Object.entries(comparisonMetrics)
        .map(
          ([metric, d]) =>
            `<figure><figcaption>${esc(d.label)} · pinned (teal) / selected (purple)</figcaption>${barsSvg(comparisonRows(current, compatible, metric as keyof typeof comparisonMetrics), d.label, d.unit)}</figure>`,
        )
        .join("") +
      `<figure><figcaption>Completion and outside waiting · pinned (teal) / selected (purple)</figcaption>${barsSvg(populationComparisonRows(current, compatible), "Completion and outside waiting", "people")}</figure>`
    : `<p>Comparison charts unavailable: ${esc(reference ? comparisonReason(reference.replay.summary, r.summary) : "No reference pinned.")}</p>`;
  const row = (values: unknown[]) =>
    `<tr>${values.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`;
  return `<section class="crowd-report"><h2>Crowd Patterns — recorded visual evidence</h2><p>Status: ${esc(r.manifest.status)}. Analytical interval ${n(cadence)} s; observed end ${n(r.summary.simulated_time_s)} s. ${n(r.summary.metrics.unfinished_count)} unfinished visitors; ${r.summary.population.future} future arrivals. No accident probability or safety classification is calculated.</p><ul>${findings.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul><p>Scale is relative to displayed runs, not a safety classification. Speed nulls and missing samples appear as gaps; observations are not extrapolated past a run’s actual end. The density heatmap uses the maximum recorded sample in each window, retaining brief sampled peaks; it does not establish conditions between samples. Overlapping zones cannot be added together.</p><h3>Density by zone and time</h3><p>Density scale: 0–${n(max)} people/m². Pale blue = zero; purple = scale maximum; grey = no recorded samples. Hover cells for sample counts and timestamps; coloured windows may have incomplete coverage.</p>${heatmapSvg(r, max)}${primary ? figure({ title: `${zoneLabel(primary)} — density (highest recorded sampled peak zone)`, unit: "people/m²", series: metricSeries("density"), end, max, cadence, bands: lowSpeedIntervals(rows, cadence, r.summary.measurement.slow_speed_m_s) }) + figure({ title: `${zoneLabel(primary)} — mean movement speed`, unit: "m/s", series: metricSeries("speed"), end, cadence }) : "<p>No recorded zone samples.</p>"}<p>Density chart shading marks selected occupied intervals below mean speed ${n(r.summary.measurement.slow_speed_m_s)} m/s. This diagnostic is not a safety limit; service waiting can explain low speed.</p>${figure({ title: "People inside and waiting", unit: "people", series: populationSeries, end: r.summary.simulated_time_s, cadence })}<p>Queued and in-service people are subsets of inside total; do not sum these lines.</p>${figure({ title: "Arrival and journey accounting", unit: "people", series: accountingSeries, end: r.summary.simulated_time_s, cadence })}<p>Arrivals observed includes scheduled arrivals waiting outside and is not admissions.</p><h3>Scenario comparison charts</h3>${compared}<p>* marks changed usable area; density denominators differ. Recorded ends: selected ${n(r.summary.simulated_time_s)} s${compatible ? `, pinned ${n(compatible.replay.summary.simulated_time_s)} s` : ""}. No overall winner is inferred.</p><p><a download="sahajyatra-zone-samples.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(analyticalCsv(r))}">Download original crowd measurements CSV (embedded)</a></p><details class="full-samples"><summary>Original analytical zone samples — accessible data table</summary><table><thead><tr><th>Zone</th><th>Time (s)</th><th>Count</th><th>Density (people/m²)</th><th>Mean speed (m/s)</th></tr></thead><tbody>${r.zone_samples.map((s) => row([zoneLabel(s.id), s.t, s.count, s.density, s.speed ?? "Unavailable"])).join("")}</tbody></table></details><details class="full-samples"><summary>Original population samples — accessible data table</summary><table><thead><tr><th>Time (s)</th><th>Inside</th><th>Outside</th><th>Queued</th><th>Serving</th><th>Future</th><th>Completed</th><th>Arrivals observed</th></tr></thead><tbody>${r.ledger.map((s) => row([s.time_s, s.active, s.waiting_outside, s.queued, s.serving, s.future, s.completed, s.scheduled_by_time])).join("")}</tbody></table></details><p>Original sample tables are available in the HTML; the CSV preserves full recorded zone precision. Full sample tables are omitted from printing to keep the committee report readable.</p></section>`;
}
