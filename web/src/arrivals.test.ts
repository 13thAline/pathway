import { percentageToFraction, fractionToPercentage } from "./arrivals";
import { describe, expect, it } from "vitest";
import vectors from "./fixtures/arrival-allocation.json";
import { arrivalPreview, minutesToSeconds, secondsToMinutes } from "./arrivals";
import { defaults } from "./types";
describe("arrival allocation against backend-generated demand streams", () => {
  it.each(vectors)(
    "$count visitors, fraction $fraction => $peak peak",
    ({ count, fraction, peak }) => {
      const p = arrivalPreview({
        ...defaults,
        count,
        settings: { ...defaults.settings, peak_fraction: fraction },
      })!;
      expect(p.peak).toBe(peak);
      expect(p.tail).toBe(count - peak);
      expect(p.approximate).toBe(false);
    },
  );
  it("does not misrepresent staggered group allocation as window counts", () => {
    const p = arrivalPreview({ ...defaults, variant: "staggered" })!;
    expect(p.peak).toBe(150);
    expect(p.tail).toBe(350);
    expect(p.approximate).toBe(true);
  });
  it("converts organizer minutes and short windows without rounding seconds", () => {
    expect(minutesToSeconds(3)).toBe(180);
    expect(minutesToSeconds(0.5)).toBe(30);
    expect(secondsToMinutes(180)).toBe(3);
    expect(minutesToSeconds(secondsToMinutes(1))).toBe(1);
    expect(
      arrivalPreview({
        ...defaults,
        settings: {
          ...defaults.settings,
          peak_end_s: 0.01,
          arrival_end_s: 0.02,
        },
      })?.peakMinutes,
    ).toBe(0.01 / 60);
  });
  it("suppresses invalid previews", () => {
    expect(arrivalPreview({ ...defaults, count: NaN })).toBeNull();
    expect(
      arrivalPreview({
        ...defaults,
        settings: { ...defaults.settings, peak_end_s: 600 },
      }),
    ).toBeNull();
  });
});

it("converts organizer percentage controls without changing fractional engine inputs", () => {
  expect(percentageToFraction(70)).toBe(0.7);
  expect(fractionToPercentage(0.7)).toBe(70);
  expect(percentageToFraction(0)).toBe(0);
  expect(percentageToFraction(100)).toBe(1);
  expect(percentageToFraction(33.5)).toBe(0.335);
});
