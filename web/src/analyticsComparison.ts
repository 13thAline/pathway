import { comparisonReason } from "./model";
import type { Loaded } from "./types";
import { numberLabel, zoneLabel, type CrowdFinding } from "./analytics";
import type { BarRow } from "./chartSvg";
export const comparisonMetrics = {
  peak_density_per_m2: { label: "Peak sampled density", unit: "people/m²" },
  sampled_person_s: { label: "Accumulated exposure", unit: "person-s" },
  sampled_slow_s: { label: "Occupied low-speed duration", unit: "s" },
} as const;
export type ComparisonMetric = keyof typeof comparisonMetrics;
export function comparisonRows(
  current: Loaded,
  reference: Loaded,
  metric: ComparisonMetric,
): BarRow[] {
  return Object.entries(current.replay.summary.zones).map(([id, z]) => ({
    label: zoneLabel(id),
    selected: z[metric],
    reference: reference.replay.summary.zones[id]?.[metric] ?? null,
    changedArea:
      Math.abs(
        z.area_m2 - (reference.replay.summary.zones[id]?.area_m2 ?? z.area_m2),
      ) > 1e-8,
  }));
}

export function populationComparisonRows(
  current: Loaded,
  reference: Loaded,
): BarRow[] {
  return [
    ["Completed journeys", "completed_count"],
    ["Peak outside waiting", "peak_outside_count"],
  ].map(([label, key]) => ({
    label,
    selected: current.replay.summary.metrics[key] ?? null,
    reference: reference.replay.summary.metrics[key] ?? null,
  }));
}

/** Only compatible pairs support these descriptive exposure differences. */
export function exposureFindings(
  current: Loaded,
  reference: Loaded,
): CrowdFinding[] {
  if (comparisonReason(reference.replay.summary, current.replay.summary))
    return [];
  const changes = Object.entries(current.replay.summary.zones).map(
    ([id, z]) => ({
      id,
      delta:
        z.sampled_person_s -
        reference.replay.summary.zones[id].sampled_person_s,
      areaChanged:
        Math.abs(z.area_m2 - reference.replay.summary.zones[id].area_m2) > 1e-8,
    }),
  );
  const increase = [...changes]
    .filter((c) => c.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0];
  const decrease = [...changes]
    .filter((c) => c.delta < 0)
    .sort((a, b) => a.delta - b.delta)[0];
  return [increase, decrease]
    .filter((v): v is (typeof changes)[number] => !!v)
    .map((c) => ({
      zone: c.id,
      mode: "sampled_person_s",
      text: `Largest recorded exposure ${c.delta > 0 ? "increase" : "decrease"}: ${zoneLabel(c.id)}, ${numberLabel(Math.abs(c.delta))} person-s ${c.delta > 0 ? "more" : "less"} than the pinned plan.${c.areaChanged ? " Measurement area also changed." : ""} Inspect the zone and route assumptions; this is not an overall plan ranking.`,
    }));
}
