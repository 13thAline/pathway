import type { Request } from "./types";
import { validateRequest } from "./model";

/** Mirrors pathway.puja.split_count, including stable tie order. */
export function splitCount(count: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (count * w) / sum);
  const result = raw.map(Math.floor);
  const order = raw
    .map((_, i) => i)
    .sort((a, b) => raw[b] - result[b] - (raw[a] - result[a]) || a - b);
  for (const i of order.slice(0, count - result.reduce((a, b) => a + b, 0)))
    result[i]++;
  return result;
}
export const percentageToFraction = (percentage: number) => percentage / 100;
export const fractionToPercentage = (fraction: number) => fraction * 100;
export const minutesToSeconds = (minutes: number) => minutes * 60;
export const secondsToMinutes = (seconds: number) => seconds / 60;
export function arrivalPreview(request: Request) {
  if (validateRequest(request).length) return null;
  const s = request.settings;
  let peak = 0;
  for (const origin of splitCount(request.count, [0.6, 0.4]))
    for (const lane of splitCount(origin, [1, 1, 1]))
      for (const group of splitCount(lane, [1, 1]))
        peak += splitCount(group, [s.peak_fraction, 1 - s.peak_fraction])[0];
  const staggered = request.variant === "staggered";
  return {
    peak: staggered ? (request.count * s.peak_end_s) / s.arrival_end_s : peak,
    tail: staggered
      ? request.count * (1 - s.peak_end_s / s.arrival_end_s)
      : request.count - peak,
    approximate: staggered,
    peakMinutes: secondsToMinutes(s.peak_end_s),
    totalMinutes: secondsToMinutes(s.arrival_end_s),
  };
}
