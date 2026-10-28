import {
  densityColor,
  heatCells,
  numberLabel as n,
  svgEscape as esc,
  zoneLabel,
  zoneSeries,
  type Series,
} from "./analytics";
import type { Replay } from "./types";
export const chartGeometry = {
  width: 800,
  left: 60,
  right: 20,
  top: 20,
  bottom: 190,
  height: 240,
};
export type LineSpec = {
  title: string;
  unit: string;
  series: Series[];
  end: number;
  max?: number;
  cadence: number;
  cursor?: number;
  bands?: { start: number; end: number }[];
};
export function lineSvg(spec: LineSpec): string {
  const g = chartGeometry,
    end = Math.max(spec.end, 1e-9),
    observedMaximum =
      spec.max ??
      Math.max(
        0,
        ...spec.series.flatMap((s) => s.points.map((p) => p.value ?? 0)),
      ),
    max = observedMaximum > 0 ? observedMaximum : 1;
  const x = (t: number) => g.left + ((g.width - g.left - g.right) * t) / end;
  const y = (v: number) => g.bottom - (g.bottom - g.top) * (v / max);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<line x1="60" x2="780" y1="${y(f * max)}" y2="${y(f * max)}" stroke="#d5dde5"/><text x="52" y="${y(f * max) + 4}" text-anchor="end">${esc(n(f * max))}</text><text x="${x(f * end)}" y="211" text-anchor="middle">${esc(n((f * end) / 60, 2))}</text>`,
    )
    .join("");
  const bands = (spec.bands ?? [])
    .map(
      (b) =>
        `<rect x="${x(b.start)}" y="20" width="${Math.max(0, x(b.end) - x(b.start))}" height="170" fill="#f3d998" opacity=".6"/>`,
    )
    .join("");
  const lines = spec.series
    .map((s) => {
      let previous: number | null = null;
      const path: string[] = [];
      for (const p of s.points) {
        if (p.value === null) {
          previous = null;
          continue;
        }
        const start = previous === null || p.t - previous > spec.cadence + 1e-7;
        path.push(
          `${start ? "M" : "L"}${x(p.t).toFixed(3)},${y(p.value).toFixed(3)}`,
        );
        previous = p.t;
      }
      const markers = s.points
        .map((p, i) => {
          const before = s.points[i - 1],
            after = s.points[i + 1];
          const linkedBefore =
            before &&
            before.value !== null &&
            p.t - before.t <= spec.cadence + 1e-7;
          const linkedAfter =
            after &&
            after.value !== null &&
            after.t - p.t <= spec.cadence + 1e-7;
          return p.value !== null && !linkedBefore && !linkedAfter
            ? `<circle cx="${x(p.t)}" cy="${y(p.value)}" r="2.5" fill="${esc(s.color)}"/>`
            : "";
        })
        .join("");
      return `${markers}<path d="${path.join(" ")}" fill="none" stroke="${esc(s.color)}" stroke-width="2"${s.dashed ? ' stroke-dasharray="6 4"' : ""}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240" role="img" aria-label="${esc(spec.title)}"><title>${esc(spec.title)} — ${esc(spec.unit)}; time in minutes</title><g font-family="system-ui" font-size="11" fill="#344454">${bands}${grid}${lines}${spec.cursor !== undefined && spec.cursor >= 0 && spec.cursor <= spec.end ? `<line x1="${x(spec.cursor)}" x2="${x(spec.cursor)}" y1="20" y2="190" stroke="#202b38" stroke-dasharray="3 3"/>` : ""}<text x="60" y="12">${esc(spec.unit)}</text><text x="420" y="235" text-anchor="middle">Simulated time (minutes)</text></g></svg>`;
}
export function heatmapSvg(
  r: Replay,
  maximum: number,
  cursor?: number,
): string {
  const ids = Object.keys(r.summary.zones),
    end = r.summary.simulated_time_s;
  const width = 800,
    left = 170,
    plotWidth = 610,
    rowHeight = 30,
    height = ids.length * rowHeight + 60;
  const rows = ids
    .map((id, i) => {
      const cells = heatCells(zoneSeries(r, id), end);
      return (
        `<text x="160" y="${i * rowHeight + 31}" text-anchor="end">${esc(zoneLabel(id))}</text>` +
        cells
          .map(
            (c, j) =>
              `<rect data-zone="${esc(id)}" data-time="${c.sample?.t ?? c.start}" x="${left + (j * plotWidth) / cells.length}" y="${i * rowHeight + 13}" width="${plotWidth / cells.length + 0.1}" height="24" fill="${densityColor(c.sample?.density ?? null, maximum)}"><title>${esc(zoneLabel(id))}: ${n(c.start)}–${n(c.end)} s; ${c.sample ? `max recorded density ${n(c.sample.density)} people/m² at ${n(c.sample.t)} s; ${c.count} recorded samples` : "unavailable"}</title></rect>`,
          )
          .join("")
      );
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Density by zone and time"><g font-family="system-ui" font-size="11" fill="#344454">${rows}${cursor !== undefined && end > 0 && cursor <= end ? `<line x1="${left + (cursor / end) * plotWidth}" x2="${left + (cursor / end) * plotWidth}" y1="10" y2="${height - 45}" stroke="#f59e0b" stroke-width="2"/>` : ""}<text x="170" y="${height - 20}">0 min</text><text x="780" y="${height - 20}" text-anchor="end">${n(end / 60, 2)} min</text></g></svg>`;
}
export type BarRow = {
  label: string;
  selected: number | null;
  reference: number | null;
  changedArea?: boolean;
};
export function barsSvg(rows: BarRow[], title: string, unit: string): string {
  const maximum = Math.max(
      1e-9,
      ...rows.flatMap((r) => [r.selected ?? 0, r.reference ?? 0]),
    ),
    height = rows.length * 44 + 45;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)} — ${esc(unit)}</title><g font-family="system-ui" font-size="11" fill="#344454"><text x="200" y="12">${esc(unit)}; shared scale 0–${n(maximum)}</text>${rows.map((r, i) => `<text x="190" y="${i * 44 + 37}" text-anchor="end">${esc(r.label)}${r.changedArea ? " *" : ""}</text>${(["reference", "selected"] as const).map((key, j) => `<rect x="200" y="${i * 44 + 22 + j * 14}" width="${((r[key] ?? 0) / maximum) * 470}" height="10" fill="${key === "selected" ? "#6d28d9" : "#147d92"}"/><text x="680" y="${i * 44 + 31 + j * 14}">${esc(n(r[key]))}</text>`).join("")}`).join("")}</g></svg>`;
}
