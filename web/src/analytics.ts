import type { Replay } from "./types";
export type ZoneSample = Replay["zone_samples"][number];
export type Point = { t: number; value: number | null };
export type Series = {
  name: string;
  color: string;
  points: Point[];
  dashed?: boolean;
};
export const zoneLabel = (id: string) =>
  id.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const numberLabel = (n: number | null | undefined, digits = 3) =>
  n == null
    ? "Unavailable"
    : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
export const svgEscape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Analytical fields consumed by visualizations must be checked independently of display frames. */
export function validateAnalytics(r: Replay): void {
  const cadence = r.summary.measurement.sample_interval_s;
  if (
    !(cadence > 0) ||
    !Number.isFinite(cadence) ||
    r.summary.measurement.slow_speed_m_s < 0 ||
    !Number.isFinite(r.summary.measurement.slow_speed_m_s)
  )
    throw Error("Invalid analytical sampling interval.");
  const ids = new Set(r.scenario.zones.map((z) => z.id));
  if (
    ids.size !== r.scenario.zones.length ||
    [...ids].some(
      (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id),
    ) ||
    Object.keys(r.summary.zones).some((id) => !ids.has(id))
  )
    throw Error("Analytical zones do not match the venue.");
  for (const z of Object.values(r.summary.zones))
    if (!(z.area_m2 > 0) || !Number.isFinite(z.area_m2))
      throw Error("Invalid analytical zone area.");
  let previous = -1;
  const seen = new Set<string>();
  for (const row of r.zone_samples) {
    const z = row && r.summary.zones[row.id];
    if (
      !z ||
      !Object.hasOwn(r.summary.zones, row.id) ||
      !ids.has(row.id) ||
      !Number.isFinite(row.t) ||
      row.t < previous ||
      row.t < 0 ||
      row.t > r.summary.simulated_time_s ||
      !Number.isInteger(row.count) ||
      row.count < 0 ||
      row.count > r.request.count ||
      row.count > z.peak_count ||
      row.density > z.peak_density_per_m2 + 1e-7 ||
      !Number.isFinite(row.density) ||
      row.density < 0 ||
      Math.abs(row.density - row.count / z.area_m2) >
        1e-7 * Math.max(1, row.density) ||
      !(
        row.speed === null ||
        (typeof row.speed === "number" &&
          Number.isFinite(row.speed) &&
          row.speed >= 0)
      ) ||
      seen.has(`${row.id}:${row.t}`)
    )
      throw Error(
        "Invalid analytical zone samples (time, count, density or speed).",
      );
    seen.add(`${row.id}:${row.t}`);
    previous = row.t;
  }
  for (const row of r.ledger) {
    if (
      !["queued", "serving", "scheduled_by_time", "total"].every(
        (k) =>
          Number.isInteger(row[k as keyof typeof row]) &&
          row[k as keyof typeof row] >= 0,
      ) ||
      row.total !== r.request.count ||
      row.queued + row.serving > row.active ||
      row.scheduled_by_time !== r.request.count - row.future
    )
      throw Error("Invalid analytical population ledger.");
  }
}
export function zoneSeries(r: Replay, id: string): ZoneSample[] {
  return r.zone_samples.filter((row) => row.id === id);
}
export function sampleAt(
  rows: ZoneSample[],
  time: number,
  cadence: number,
  end: number,
): ZoneSample | null {
  if (time < 0 || time > end) return null;
  let low = 0,
    high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle].t <= time) low = middle + 1;
    else high = middle;
  }
  const row = rows[low - 1];
  return row && (time - row.t < cadence - 1e-8 || Math.abs(time - row.t) < 1e-8)
    ? row
    : null;
}
export function densityColor(value: number | null, max: number): string {
  if (value === null) return "#bfc4cb";
  const f = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const from = [239, 246, 255],
    to = [76, 29, 149];
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * f)).join(",")})`;
}
export const densityMaximum = (...runs: (Replay | undefined)[]) =>
  Math.max(
    0,
    ...runs.flatMap((r) =>
      r ? Object.values(r.summary.zones).map((z) => z.peak_density_per_m2) : [],
    ),
  );
export function lowSpeedIntervals(
  rows: ZoneSample[],
  cadence: number,
  threshold: number,
): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i],
      b = rows[i + 1];
    if (
      b.t - a.t <= cadence + 1e-7 &&
      a.count > 0 &&
      a.speed !== null &&
      a.speed < threshold
    )
      result.push({ start: a.t, end: b.t });
  }
  return result;
}
export type HeatCell = {
  start: number;
  end: number;
  sample: ZoneSample | null;
  count: number;
};
export function heatCells(
  rows: ZoneSample[],
  end: number,
  bins = 90,
): HeatCell[] {
  if (end <= 0)
    return [{ start: 0, end: 0, sample: rows[0] ?? null, count: rows.length }];
  const result: HeatCell[] = Array.from({ length: bins }, (_, i) => ({
    start: (i * end) / bins,
    end: ((i + 1) * end) / bins,
    sample: null,
    count: 0,
  }));
  for (const row of rows) {
    const c = result[Math.min(bins - 1, Math.floor((row.t / end) * bins))];
    if (!c) continue;
    c.count++;
    if (!c.sample || row.density > c.sample.density) c.sample = row;
  }
  return result;
}
export type CrowdFinding = {
  zone: string;
  time?: number;
  mode?: "density" | "sampled_slow_s" | "sampled_person_s";
  text: string;
};
export function crowdFindings(r: Replay): CrowdFinding[] {
  const peak = r.zone_samples.reduce<ZoneSample | null>(
    (a, b) => (!a || b.density > a.density ? b : a),
    null,
  );
  const zones = Object.entries(r.summary.zones);
  const slow = [...zones].sort(
    (a, b) => b[1].sampled_slow_s - a[1].sampled_slow_s,
  )[0];
  const exposure = [...zones].sort(
    (a, b) => b[1].sampled_person_s - a[1].sampled_person_s,
  )[0];
  return [
    ...(peak
      ? [
          {
            zone: peak.id,
            time: peak.t,
            mode: "density" as const,
            text: `Highest recorded sampled density: ${zoneLabel(peak.id)}, ${numberLabel(peak.density)} people/m² at ${numberLabel(peak.t)} s. Inspect this area and its route assumptions. Ties use the first recorded sample.`,
          },
        ]
      : []),
    ...(slow
      ? [
          {
            zone: slow[0],
            mode: "sampled_slow_s" as const,
            text: `Longest recorded occupied low-speed duration: ${zoneLabel(slow[0])}, ${numberLabel(slow[1].sampled_slow_s)} s below mean speed ${numberLabel(r.summary.measurement.slow_speed_m_s)} m/s. Review whether service waiting explains this.`,
          },
        ]
      : []),
    ...(exposure
      ? [
          {
            zone: exposure[0],
            mode: "sampled_person_s" as const,
            text: `Greatest recorded exposure: ${zoneLabel(exposure[0])}, ${numberLabel(exposure[1].sampled_person_s)} person-s. Inspect sustained occupancy; overlapping zones must not be added together.`,
          },
        ]
      : []),
  ];
}
export function analyticalCsv(r: Replay): string {
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = [
    "scenario_sha256",
    "status",
    "sample_interval_s",
    "time_s",
    "zone",
    "count",
    "density_people_per_m2",
    "mean_speed_m_s",
  ];
  return [
    header.join(","),
    ...r.zone_samples.map((row) =>
      [
        r.manifest.scenario_sha256,
        r.manifest.status,
        r.summary.measurement.sample_interval_s,
        row.t,
        row.id,
        row.count,
        row.density,
        row.speed,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}
