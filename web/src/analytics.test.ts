import { exposureFindings } from "./analyticsComparison";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyticalCsv,
  crowdFindings,
  densityColor,
  heatCells,
  lowSpeedIntervals,
  sampleAt,
  validateAnalytics,
  zoneSeries,
  type ZoneSample,
} from "./analytics";
import { barsSvg, heatmapSvg, lineSvg } from "./chartSvg";
import { decodeEnvelope, reportHtml } from "./model";
const envelope = (variant = "baseline") =>
  JSON.parse(
    readFileSync(
      new URL(`../public/demos/${variant}.json`, import.meta.url),
      "utf8",
    ),
  );
const load = async (variant = "baseline") =>
  decodeEnvelope(envelope(variant), "example");
const sample = (
  t: number,
  count = 2,
  speed: number | null = 0.2,
): ZoneSample => ({ id: "test", t, count, density: count / 10, speed });
async function seal(payload: unknown) {
  const data = JSON.stringify(payload);
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return { data, sha256 };
}
describe("analytical import validation", () => {
  it.each(["baseline", "second_exit", "staggered"])(
    "accepts actual %s measurement records",
    async (variant) => {
      const { replay } = await load(variant);
      expect(() => validateAnalytics(replay)).not.toThrow();
      expect(replay.zone_samples.length).toBeGreaterThan(5000);
    },
  );
  it.each([
    { t: -1 },
    { t: NaN },
    { t: Infinity },
    { id: "unknown" },
    { count: -1 },
    { count: 1.5 },
    { density: -1 },
    { density: NaN },
    { speed: NaN },
    { speed: -0.1 },
    { speed: Infinity },
    { speed: undefined },
  ])("rejects invalid analytical fields %j", async (patch) => {
    const { replay } = await load();
    Object.assign(replay.zone_samples[0], patch);
    expect(() => validateAnalytics(replay)).toThrow("analytical");
  });
  it("rejects forged density, duplicated samples, time reversal and impossible queue accounting", async () => {
    for (const mutate of [
      (r: any) => (r.zone_samples[0].density = 1),
      (r: any) => r.zone_samples.splice(1, 0, r.zone_samples[0]),
      (r: any) => (r.zone_samples[0].t = 1),
      (r: any) => (r.ledger[0].queued = 1),
      (r: any) => (r.ledger[0].scheduled_by_time = 1),
      (r: any) => (r.summary.zones.approach_A.area_m2 = 0),
    ]) {
      const { replay } = await load();
      mutate(replay);
      expect(() => validateAnalytics(replay)).toThrow();
    }
  });
  it("valid checksum cannot bypass analytical validation", async () => {
    const payload = JSON.parse(envelope().data);
    payload.zone_samples[0].density = 20;
    await expect(decodeEnvelope(await seal(payload))).rejects.toThrow(
      "analytical",
    );
  });
  it("permits missing analytical samples without inventing replacements", async () => {
    const { replay } = await load();
    replay.zone_samples = [];
    expect(() => validateAnalytics(replay)).not.toThrow();
    expect(zoneSeries(replay, "service_queue")).toEqual([]);
    expect(sampleAt([], 180, 1, replay.summary.simulated_time_s)).toBeNull();
  });
});
describe("time, gaps and diagnostic intervals", () => {
  it("holds only within a sample interval and never beyond observation end", () => {
    const rows = [sample(0), sample(1), sample(4), sample(4.25)];
    expect(sampleAt(rows, 0.5, 1, 4.25)?.t).toBe(0);
    expect(sampleAt(rows, 1, 1, 4.25)?.t).toBe(1);
    expect(sampleAt(rows, 2, 1, 4.25)).toBeNull();
    expect(sampleAt(rows, -1, 1, 4.25)).toBeNull();
    expect(sampleAt(rows, 4.25, 1, 4.25)?.t).toBe(4.25);
    expect(sampleAt(rows, 5, 1, 4.25)).toBeNull();
  });
  it("matches left-held occupied low-speed rules and omits gaps, nulls and equality", () => {
    const rows = [
      sample(0, 2, 0.2),
      sample(1, 0, 0.1),
      sample(2, 2, null),
      sample(3, 2, 0.3),
      sample(4, 2, 0.1),
      sample(7, 2, 0.1),
      sample(7.2, 2, 0.1),
    ];
    expect(lowSpeedIntervals(rows, 1, 0.3)).toEqual([
      { start: 0, end: 1 },
      { start: 7, end: 7.2 },
    ]);
  });
  it("uses maximum recorded density per bin, preserves brief peaks, ties and unavailable bins", () => {
    const rows = [
      sample(0, 1),
      sample(1, 5),
      sample(2, 3),
      sample(9, 2),
      sample(10, 1),
    ];
    const cells = heatCells(rows, 10, 5);
    expect(cells[0].sample?.t).toBe(1);
    expect(cells[0].count).toBe(2);
    expect(cells[2].sample).toBeNull();
    expect(cells[4].sample?.t).toBe(9);
    expect(cells[4].count).toBe(2);
    expect(heatCells([sample(0)], 0)[0].sample?.t).toBe(0);
  });
  it("distinguishes no measurement from zero on the colour scale", () => {
    expect(densityColor(null, 2)).not.toBe(densityColor(0, 2));
    expect(densityColor(0, 0)).toBe(densityColor(0, 2));
    expect(densityColor(2, 2)).toBe(densityColor(4, 4));
  });
});
describe("SVG, findings and actual report evidence", () => {
  it("breaks SVG paths at unavailable samples and long gaps, keeping isolated points visible", () => {
    const html = lineSvg({
      title: "Test <script>",
      unit: "people/m²",
      end: 6,
      cadence: 1,
      max: 0.5,
      series: [
        {
          name: "test",
          color: "#123456",
          points: [
            { t: 0, value: 0.1 },
            { t: 1, value: null },
            { t: 2, value: 0.2 },
            { t: 3, value: 0.3 },
            { t: 6, value: 0.4 },
          ],
        },
      ],
    });
    expect(html).toContain(
      "M60.000,156.000 M300.000,122.000 L420.000,88.000 M780.000,54.000",
    );
    expect(html).toContain("<circle");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).toContain(">0.5</text>");
  });
  it("renders zero-duration and empty charts without non-finite SVG coordinates", () => {
    const svg = lineSvg({
      title: "empty",
      unit: "people",
      end: 0,
      cadence: 1,
      series: [],
    });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(
      barsSvg(
        [{ label: "none", selected: null, reference: 0 }],
        "Empty",
        "people",
      ),
    ).toContain("Unavailable");
  });
  it("findings identify actual peak samples and recorded summary maxima", async () => {
    const { replay } = await load();
    const f = crowdFindings(replay);
    const maximum = Math.max(...replay.zone_samples.map((s) => s.density));
    const peak = replay.zone_samples.find((s) => s.density === maximum)!;
    expect(f[0].zone).toBe(peak.id);
    expect(f[0].time).toBe(peak.t);
    const slow = Object.entries(replay.summary.zones).sort(
      (a, b) => b[1].sampled_slow_s - a[1].sampled_slow_s,
    )[0];
    expect(f[1].zone).toBe(slow[0]);
  });
  it("CSV keeps full sample precision, null speed and run provenance", async () => {
    const { replay } = await load();
    const csv = analyticalCsv(replay);
    expect(csv.split("\r\n")).toHaveLength(replay.zone_samples.length + 1);
    expect(csv).toContain(replay.manifest.scenario_sha256);
    expect(csv).toContain("mean_speed_m_s");
    expect(csv.split("\r\n")[1]).toMatch(/,""$/);
  });
  it("report includes self-contained chart evidence, samples, CSV, units and valid comparison", async () => {
    const a = await load(),
      b = await load("second_exit");
    const html = reportHtml(b, a);
    for (const text of [
      "Crowd Patterns — recorded visual evidence",
      "Density by zone and time",
      "<svg",
      "Original analytical zone samples",
      "data:text/csv",
      "sampled peaks",
      "Queued and in-service people are subsets",
      "changed usable area",
    ])
      expect(html).toContain(text);
    expect(html).not.toMatch(/<script|<iframe/);
    expect(html).toContain(b.replay.manifest.scenario_sha256);
    b.replay.summary.identity_sha256 = "unmatched";
    expect(reportHtml(b, a)).toContain("Comparison charts unavailable");
  });
  it("heatmap displays missing observations distinctly without smoothing", async () => {
    const { replay } = await load();
    replay.zone_samples = [];
    expect(heatmapSvg(replay, 2)).toContain('fill="#bfc4cb"');
    expect(heatmapSvg(replay, 2)).toContain("unavailable");
  });
});

it("comparative review cards link actual exposure changes and suppress incompatible or unchanged pairs", async () => {
  const a = await load(),
    b = await load("second_exit");
  const cards = exposureFindings(b, a);
  expect(cards).toHaveLength(2);
  for (const c of cards) {
    const difference =
      b.replay.summary.zones[c.zone].sampled_person_s -
      a.replay.summary.zones[c.zone].sampled_person_s;
    expect(c.text).toContain(difference > 0 ? "increase" : "decrease");
    expect(c.mode).toBe("sampled_person_s");
  }
  expect(exposureFindings(a, a)).toEqual([]);
  b.replay.summary.usable_for_comparison = false;
  expect(exposureFindings(b, a)).toEqual([]);
});
