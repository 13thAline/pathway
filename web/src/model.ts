import { analyticsReport } from "./analyticsReport";
import { validateAnalytics } from "./analytics";
import {
  planningReportSections,
  type PlanningEvidence,
} from "./planningReport";
import {
  defaults,
  type Envelope,
  type Frame,
  type Loaded,
  type Request,
  type Summary,
} from "./types";
export function requestKey(value: Request): string {
  return JSON.stringify([
    value.variant,
    value.count,
    value.seed,
    ...Object.keys(defaults.settings)
      .sort()
      .map((k) => value.settings[k as keyof typeof defaults.settings]),
  ]);
}
export function validateRequest(value: Request): string[] {
  const s = value.settings,
    errors: string[] = [];
  if (!Number.isInteger(value.count) || value.count < 1 || value.count > 750)
    errors.push("Visitors must be a whole number from 1 to 750.");
  if (
    !Number.isInteger(value.seed) ||
    value.seed < 0 ||
    value.seed > 4294967295
  )
    errors.push("Seed must be a whole number from 0 to 4294967295.");
  if (!Object.values(s).flat().every(Number.isFinite))
    errors.push("Every input needs a finite number.");
  if (!(
    s.main_gate_width_m === 0 ||
    (s.main_gate_width_m > 0.4 && s.main_gate_width_m <= 4)
  ))
    errors.push(
      "Main gate: use 0 (closed), or more than 0.4 and at most 4 metres.",
    );
  if (s.main_gate_width_m === 0 && value.variant !== "second_exit")
    errors.push("A closed main gate requires the additional-exit plan.");
  if (!(s.second_gate_width_m > 0.4 && s.second_gate_width_m <= 4))
    errors.push("Second gate must be wider than 0.4 and at most 4 metres.");
  if (!(
    s.peak_end_s > 0 &&
    s.peak_end_s < s.arrival_end_s &&
    s.arrival_end_s <= 1800 &&
    s.arrival_end_s <= s.horizon_s
  ))
    errors.push(
      "Arrival windows must satisfy: 0 < peak end < last arrival ≤ horizon (arrivals ≤ 1800 s).",
    );
  if (s.peak_fraction < 0 || s.peak_fraction > 1)
    errors.push("Peak share must be between 0 and 100%.");
  if (!(s.horizon_s > 0 && s.horizon_s <= 3600))
    errors.push("Horizon must be 1–3600 seconds.");
  if (!(
    s.service_s[0] >= 0 &&
    s.service_s[0] <= s.service_s[1] &&
    s.service_s[1] <= 600
  ))
    errors.push("Service durations must be ordered between 0 and 600 seconds.");
  if (!(
    s.speed_m_s[0] >= 0.1 &&
    s.speed_m_s[0] <= s.speed_m_s[1] &&
    s.speed_m_s[1] <= 3
  ))
    errors.push("Walking speeds must be ordered between 0.1 and 3 m/s.");
  if (
    !(s.dt_s >= 0.001 && s.dt_s <= 0.05) ||
    Math.abs(1 / s.dt_s - Math.round(1 / s.dt_s)) > 1e-7 ||
    Math.abs(s.horizon_s / s.dt_s - Math.round(s.horizon_s / s.dt_s)) > 1e-7
  )
    errors.push(
      "Timestep must divide the 1-second reporting interval and the horizon exactly.",
    );
  return errors;
}
export function held<T extends { t: number }>(rows: T[], time: number): T {
  let low = 0,
    high = rows.length - 1;
  while (low < high) {
    const m = Math.ceil((low + high) / 2);
    if (rows[m].t <= time) low = m;
    else high = m - 1;
  }
  return rows[low];
}
export function frameAt(frames: Frame[], time: number): Frame {
  return held(frames, time);
}
export async function decodeEnvelope(
  value: unknown,
  origin: Loaded["origin"] = "file",
): Promise<Loaded> {
  const envelope = value as Envelope;
  if (
    !envelope ||
    typeof envelope.data !== "string" ||
    envelope.data.length > 20_000_000 ||
    !/^[a-f0-9]{64}$/.test(envelope.sha256)
  )
    throw Error("This is not a supported Pathway replay file.");
  const bytes = new TextEncoder().encode(envelope.data);
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== envelope.sha256)
    throw Error("Replay integrity check failed. The file has changed.");
  const r = JSON.parse(envelope.data);
  if (
    r.format !== "pathway-replay-1" ||
    !["saved", "fresh"].includes(r.mode) ||
    !r.request ||
    validateRequest(r.request).length ||
    !Array.isArray(r.frames) ||
    r.frames.length < 1 ||
    r.frames.length > 2000 ||
    !Array.isArray(r.ledger) ||
    r.ledger.length < 1 ||
    r.ledger.length > 4000 ||
    !r.scenario?.geometry ||
    !r.summary?.metrics ||
    !Array.isArray(r.zone_samples) ||
    r.zone_samples.length > 50000
  )
    throw Error("Replay structure is invalid or exceeds prototype limits.");
  const ring = (points: unknown): boolean =>
    Array.isArray(points) &&
    points.length >= 3 &&
    points.length <= 2000 &&
    points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(
          (x) =>
            typeof x === "number" &&
            Number.isFinite(x) &&
            x >= -100 &&
            x <= 200,
        ),
    );
  const geometry = r.scenario.geometry;
  const hash = (v: unknown) =>
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (
    !ring(geometry.boundary) ||
    !Array.isArray(geometry.obstacles) ||
    geometry.obstacles.length > 100 ||
    !geometry.obstacles.every(ring) ||
    !Array.isArray(r.scenario.zones) ||
    r.scenario.zones.length > 100 ||
    !r.scenario.zones.every((z: { polygon: unknown }) => ring(z.polygon)) ||
    !Array.isArray(r.scenario.origins) ||
    r.scenario.origins.length > 50 ||
    !Array.isArray(r.scenario.lines) ||
    r.scenario.lines.length > 100 ||
    !Array.isArray(r.scenario.services) ||
    r.scenario.services.length > 50 ||
    !hash(r.manifest?.scenario_sha256) ||
    !hash(r.manifest?.demand_sha256) ||
    !hash(r.summary.identity_sha256) ||
    !hash(r.request_sha256) ||
    !Array.isArray(r.visitor_ids) ||
    r.visitor_ids.length !== r.request.count ||
    !Array.isArray(r.limitations) ||
    !r.limitations.every((v: unknown) => typeof v === "string") ||
    !Object.values(r.summary.metrics).every(
      (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
    )
  )
    throw Error("Replay geometry or metadata is invalid.");
  for (const [groups, field] of [
    [r.scenario.origins, "positions"],
    [r.scenario.services, "positions"],
    [r.scenario.lines, "points"],
  ] as const) {
    for (const group of groups) {
      const points = group[field];
      if (
        !Array.isArray(points) ||
        points.length < 1 ||
        points.length > 500 ||
        !points.every(
          (p: unknown) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every(
              (x) =>
                typeof x === "number" &&
                Number.isFinite(x) &&
                x >= -100 &&
                x <= 200,
            ),
        )
      )
        throw Error("Replay stage coordinates are invalid.");
    }
  }
  const metricKeys = [
    "completed_count",
    "unfinished_count",
    "restricted_mean_journey_s",
    "peak_active_count",
    "clearance_s",
    "completed_journey_p95_s",
  ];
  if (
    ![
      "succeeded",
      "horizon_reached",
      "failed",
      "cancelled",
      "timed_out",
    ].includes(r.manifest.status) ||
    r.summary.status !== r.manifest.status ||
    !hash(r.manifest.environment?.kernel_source_sha256) ||
    typeof r.manifest.environment?.packages !== "object" ||
    !r.summary.measurement ||
    !Number.isFinite(r.summary.measurement.sample_interval_s) ||
    !Number.isFinite(r.summary.measurement.slow_speed_m_s) ||
    typeof r.summary.usable_for_comparison !== "boolean" ||
    typeof r.summary.all_arrivals_observed !== "boolean" ||
    !metricKeys.every(
      (k) =>
        r.summary.metrics[k] === null || Number.isFinite(r.summary.metrics[k]),
    ) ||
    !r.summary.zones ||
    Object.keys(r.summary.zones).length > 100 ||
    !Object.values(r.summary.zones).every(
      (z: any) =>
        z &&
        [
          "area_m2",
          "peak_count",
          "peak_density_per_m2",
          "sampled_person_s",
          "sampled_occupied_s",
          "sampled_slow_s",
        ].every((k) => Number.isFinite(z[k]) && z[k] >= 0),
    )
  )
    throw Error("Replay summary metadata is invalid.");
  let previous = -1;
  for (const f of r.frames) {
    if (
      !Number.isFinite(f.t) ||
      f.t < previous ||
      f.t > 3600 ||
      !Array.isArray(f.people) ||
      f.people.length > 750
    )
      throw Error("Invalid replay frames.");
    previous = f.t;
    const ids = new Set();
    for (const p of f.people) {
      if (
        p.length !== 4 ||
        !p.every(Number.isFinite) ||
        !Number.isInteger(p[0]) ||
        p[0] < 0 ||
        p[0] >= r.request.count ||
        p[1] < -100 ||
        p[1] > 200 ||
        p[2] < -100 ||
        p[2] > 200 ||
        ![0, 1, 2].includes(p[3]) ||
        ids.has(p[0])
      )
        throw Error("Invalid replay positions.");
      ids.add(p[0]);
    }
  }
  previous = -1;
  for (const l of r.ledger) {
    if (
      !Number.isFinite(l.time_s) ||
      l.time_s < previous ||
      l.time_s > 3600 ||
      !["future", "waiting_outside", "active", "completed", "rejected"].every(
        (k) => Number.isInteger(l[k]) && l[k] >= 0,
      ) ||
      l.future + l.waiting_outside + l.active + l.completed + l.rejected !==
        r.request.count
    )
      throw Error("Replay population does not balance.");
    previous = l.time_s;
  }
  if (
    r.frames[0].t !== 0 ||
    r.ledger[0].time_s !== 0 ||
    r.frames.at(-1).t !== r.summary.simulated_time_s ||
    r.ledger.at(-1).time_s !== r.summary.simulated_time_s ||
    r.ledger.at(-1).completed !== r.summary.metrics.completed_count ||
    r.request.count - r.ledger.at(-1).completed !==
      r.summary.metrics.unfinished_count
  )
    throw Error("Replay terminal accounting is inconsistent.");
  const byTime = new Map<number, number>(
    r.ledger.map((l: any) => [l.time_s, l.active]),
  );
  if (!r.frames.every((f: any) => byTime.get(f.t) === f.people.length))
    throw Error("Replay frames disagree with population counts.");
  validateAnalytics(r);
  return { envelope, replay: r, origin };
}
export function comparisonReason(a: Summary, b: Summary): string | null {
  if (
    !a.usable_for_comparison ||
    !b.usable_for_comparison ||
    !a.all_arrivals_observed ||
    !b.all_arrivals_observed
  )
    return "One run is incomplete or has unobserved arrivals. Paired deltas are unavailable.";
  if (a.identity_sha256 !== b.identity_sha256)
    return "Visitors are not matched. Use the same count, seed, speeds and service assumptions.";
  if (a.horizon_s !== b.horizon_s)
    return "Observation horizons differ. Clone the inputs to compare at the same horizon.";
  if (
    a.measurement.sample_interval_s !== b.measurement.sample_interval_s ||
    a.measurement.slow_speed_m_s !== b.measurement.slow_speed_m_s
  )
    return "Measurement definitions differ.";
  if (
    Object.keys(a.zones).sort().join(",") !==
    Object.keys(b.zones).sort().join(",")
  )
    return "Measurement zones differ.";
  return null;
}
export function delta(a: Summary, b: Summary, key: string): number | null {
  if (comparisonReason(a, b)) return null;
  if (
    key === "completed_journey_p95_s" &&
    (a.metrics.unfinished_count || b.metrics.unfinished_count)
  )
    return null;
  const av = a.metrics[key],
    bv = b.metrics[key];
  return av == null || bv == null ? null : bv - av;
}
export const fmt = (n: number | null | undefined, digits = 1) =>
  n == null
    ? "—"
    : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
export const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const escapeHtml = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function reportHtml(
  current: Loaded,
  reference: Loaded | null,
  evidence?: PlanningEvidence,
): string {
  const planning = planningReportSections(current, reference, evidence);
  const r = current.replay,
    s = r.summary,
    a = reference?.replay.summary,
    reason = a ? comparisonReason(a, s) : null;
  const metricLabels: Record<string, string> = {
    completed_count: "Completed journeys (people)",
    unfinished_count: "Unfinished visitors (people)",
    clearance_s: "All-person clearance (s)",
    restricted_mean_journey_s:
      "Observed mean journey, censored if unfinished (s)",
    completed_journey_p95_s: "Completed-only journey p95 (s)",
    mean_outside_wait_s: "Mean outside waiting (s)",
    total_formal_queue_wait_s: "Total observed formal queue waiting (person-s)",
    peak_outside_count: "Peak outside waiting (people)",
    peak_active_count: "Peak inside population (people)",
  };
  const row = (k: string, v: unknown) =>
    `<tr><th>${escapeHtml(metricLabels[k] ?? k)}</th><td>${escapeHtml(v)}</td></tr>`;
  const zoneDeltas =
    a && !reason
      ? `<h3>Local tradeoffs</h3><table><tr><th>Zone</th><th>Exposure delta (person-s)</th><th>Usable area changed</th></tr>${Object.entries(
          s.zones,
        )
          .map(
            ([k, z]) =>
              `<tr><th>${escapeHtml(k)}</th><td>${fmt(z.sampled_person_s - a.zones[k].sampled_person_s)}</td><td>${Math.abs(z.area_m2 - a.zones[k].area_m2) > 1e-8 ? "Yes" : "No"}</td></tr>`,
          )
          .join(
            "",
          )}</table><p>Negative means lower exposure, not a safety rating.</p>`
      : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SahajYatra planning report</title><style>body{font:16px system-ui;max-width:1000px;margin:48px auto;padding:20px;color:#24342b}table{border-collapse:collapse;width:100%;margin:24px 0}td,th{padding:10px;text-align:left;border-bottom:1px solid #ccd4ce}code{word-break:break-all}h1{font-size:30px}figure{margin:24px 0;break-inside:avoid}figure svg,.crowd-report>svg{width:100%;height:auto}figcaption{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere}article, tr{break-inside:avoid}a{color:#244d35}@media print{body{margin:0}h2,h3{break-after:avoid}.full-samples{display:none}}</style><h1>SahajYatra · synthetic event planning report</h1>${planning.overview}<p>${escapeHtml(current.origin === "file" ? "Imported replay" : current.origin === "local" ? "Fresh local simulation" : "Saved demonstration")} · ${escapeHtml(r.manifest.status)} · single seed ${r.request.seed}</p><p>Observed until ${fmt(s.simulated_time_s)} s; requested horizon ${fmt(s.horizon_s)} s. Synthetic, uncalibrated model. No event approval, force or injury prediction.</p><h2>Inputs</h2><pre>${escapeHtml(JSON.stringify(r.request, null, 2))}</pre><h2>Results</h2><table>${Object.entries(
    s.metrics,
  )
    .map(([k, v]) => row(k, fmt(v)))
    .join(
      "",
    )}</table><p>Journey time includes outside waiting and is a lower bound for unfinished visitors. Completed-only p95 excludes censored visitors.</p><h2>Measurement zones</h2><table><tr><th>Zone</th><th>Area m²</th><th>Peak people/m²</th><th>Person-seconds</th></tr>${Object.entries(
    s.zones,
  )
    .map(
      ([k, z]) =>
        `<tr><th>${escapeHtml(k)}</th><td>${fmt(z.area_m2)}</td><td>${fmt(z.peak_density_per_m2, 3)}</td><td>${fmt(z.sampled_person_s)}</td></tr>`,
    )
    .join(
      "",
    )}</table><p>Density is the simulated count divided by usable area. Person-seconds integrate sampled presence over time. Zones overlap. Do not sum exposure across them. Density is sampled; small-area gate values depend on the measurement polygon.</p>${
    a
      ? `<h2>Comparison · selected minus reference</h2><p>Reference scenario: <code>${escapeHtml(reference!.replay.manifest.scenario_sha256)}</code></p>${
          reason
            ? `<p>${escapeHtml(reason)}</p>`
            : `<table>${Object.keys(s.metrics)
                .map((k) => row(k, fmt(delta(a, s, k))))
                .join("")}</table>${zoneDeltas}`
        }`
      : ""
  }${analyticsReport(current, reference)}${planning.review}<h2>Provenance</h2><p>Scenario <code>${escapeHtml(r.manifest.scenario_sha256)}</code></p><p>Demand <code>${escapeHtml(r.manifest.demand_sha256)}</code></p><p>Replay <code>${current.envelope.sha256}</code></p><p>Kernel <code>${escapeHtml(r.manifest.environment.kernel_source_sha256)}</code></p><h2>Limits</h2><ul>${r.limitations.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul><p>Additional exit includes assigned routes. Staggering reschedules arrivals; off-site costs excluded. Nominal route following is assumed. Reserved-strip geometry is not vehicle access certification.</p></html>`;
}
