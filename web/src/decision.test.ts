import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainDecision } from "./decision";
import { decodeEnvelope, reportHtml } from "./model";
import { newAudit } from "./accessibility";
import { initialEvent, inspectionContext } from "./planning";
const load = async (name: string) =>
  decodeEnvelope(
    JSON.parse(
      readFileSync(
        new URL(`../public/demos/${name}.json`, import.meta.url),
        "utf8",
      ),
    ),
    "example",
  );
describe("decisions and planning report from real fixtures", () => {
  it("explains genuine exposure changes, tradeoffs and route intervention", async () => {
    const a = await load("baseline"),
      b = await load("second_exit");
    const d = explainDecision(b, a);
    expect(d.available).toBe(true);
    for (const [id, zone] of Object.entries(b.replay.summary.zones)) {
      const diff =
        zone.sampled_person_s - a.replay.summary.zones[id].sampled_person_s;
      if (diff)
        expect(
          d.findings.some(
            (f) =>
              f.includes(id.replaceAll("_", " ")) &&
              f.includes(diff < 0 ? "reduced" : "increased"),
          ),
        ).toBe(true);
    }
    expect(d.findings.join(" ")).toContain("route assignments");
    expect(d.actions.join(" ")).toContain("physically feasible");
    expect(explainDecision(a, null).available).toBe(false);
  });
  it("rejects incompatible or failed runs and qualifies horizon-limited outputs", async () => {
    const a = await load("baseline"),
      b = await load("second_exit");
    for (const patch of [
      { identity_sha256: "different" },
      { horizon_s: 30 },
      { usable_for_comparison: false },
      { all_arrivals_observed: false },
    ]) {
      const changed = structuredClone(b);
      Object.assign(changed.replay.summary, patch);
      expect(explainDecision(changed, a).available).toBe(false);
      expect(explainDecision(changed, a).findings.join(" ")).not.toContain(
        "reduced",
      );
    }
    b.replay.summary.metrics.unfinished_count = 2;
    expect(explainDecision(b, a).findings.join(" ")).toContain("censored");
  });
  it("discloses staggered schedule costs without inventing predictions", async () => {
    const a = await load("baseline"),
      b = await load("staggered");
    expect(explainDecision(b, a).findings.join(" ")).toContain(
      "off-site waiting",
    );
  });
  it("exports selected scenario, separate audit, review items and escaped event data", async () => {
    const a = await load("baseline"),
      b = await load("second_exit");
    const event = {
      ...initialEvent,
      name: "<script>name</script>",
      arrivalSource: "Organizer estimate" as const,
    };
    const context = inspectionContext(event, b.replay.request),
      audit = newAudit(context, event.name);
    audit.measurements.aisle = 1.2;
    audit.notes = "<img src=x onerror=alert(1)>";
    const html = reportHtml(b, a, { event, audit, context });
    for (const text of [
      "Event Overview",
      "Input Assumptions",
      "Accessibility Inspection",
      "Requires review",
      "1.2 m",
      "1.5 m",
      "Organizer Review Checklist",
      "Evidence and Attribution",
      "manually reported",
      b.replay.manifest.scenario_sha256,
      a.replay.manifest.scenario_sha256,
      "Saved demonstration",
    ])
      expect(html).toContain(text);
    expect(html).toContain("&lt;script&gt;name");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    audit.context = "another event";
    expect(reportHtml(b, a, { event, audit, context })).toContain(
      "REQUIRES REVIEW",
    );
    expect(b.replay.manifest).not.toHaveProperty("audit");
  });
});
