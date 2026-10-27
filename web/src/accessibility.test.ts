import { describe, expect, it } from "vitest";
import {
  GUIDE,
  inspectAccessibility,
  newAudit,
  parseAudit,
  auditIsStale,
  measurementChecks,
  type MeasurementKey,
} from "./accessibility";
import { initialEvent, inspectionContext } from "./planning";
import { defaults } from "./types";
const create = () =>
  newAudit(inspectionContext(initialEvent, defaults), "Test event");
describe("source-backed inspection rules", () => {
  for (const [key, c] of Object.entries(measurementChecks)) {
    it.each([
      [-0.01, "Requires review"],
      [0, "Meets this specific measurement check"],
      [0.01, "Meets this specific measurement check"],
    ] as const)(`${key} threshold offset %s`, (offset, status) => {
      const a = create();
      a.measurements[key as MeasurementKey] = c.minimum + offset;
      expect(inspectAccessibility(a).find((f) => f.id === key)?.status).toBe(
        status,
      );
    });
  }
  it("distinguishes missing, zero and invalid measurements", () => {
    const a = create();
    expect(inspectAccessibility(a)[0].status).toBe("Not inspected");
    a.measurements.aisle = 0;
    expect(inspectAccessibility(a)[0].status).toBe("Requires review");
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      a.measurements.aisle = value;
      expect(inspectAccessibility(a)[0].status).toBe(
        "Insufficient information",
      );
      expect(() => parseAudit(a)).toThrow("Invalid");
    }
  });
  it("retains three states without turning reported yes into certification", () => {
    const a = create();
    expect(
      inspectAccessibility(a).find((f) => f.id === "stepFree")?.status,
    ).toBe("Not inspected");
    a.observations.stepFree = "yes";
    expect(
      inspectAccessibility(a).find((f) => f.id === "stepFree")?.status,
    ).toBe("Reported yes");
    a.observations.stepFree = "no";
    expect(
      inspectAccessibility(a).find((f) => f.id === "stepFree")?.status,
    ).toBe("Requires review");
  });
  it("supplies source, section, explanation and action for every finding", () => {
    for (const f of inspectAccessibility(create())) {
      expect(f.source).toContain(GUIDE);
      expect(f.section).toContain("2.");
      expect(f.explanation.length).toBeGreaterThan(10);
      expect(f.action.length).toBeGreaterThan(10);
    }
  });
  it("round-trips explicit JSON persistence and rejects malformed imports", () => {
    const a = create();
    a.measurements.aisle = 1.2;
    a.observations.surface = "yes";
    a.notes = "<b>inspect</b>";
    expect(parseAudit(JSON.parse(JSON.stringify(a)))).toEqual(a);
    for (const bad of [
      null,
      {},
      { ...a, schemaVersion: 2 },
      { ...a, observations: { ...a.observations, surface: "maybe" } },
      { ...a, inspectedAt: "bad date" },
      { ...a, measurements: { aisle: 1 } },
    ])
      expect(() => parseAudit(bad)).toThrow();
  });
  it("detects changed event, layout and gates while preserving audit identity", () => {
    const a = create();
    expect(auditIsStale(a, inspectionContext(initialEvent, defaults))).toBe(
      false,
    );
    expect(
      auditIsStale(
        a,
        inspectionContext({ ...initialEvent, name: "Another event" }, defaults),
      ),
    ).toBe(true);
    expect(
      auditIsStale(
        a,
        inspectionContext(initialEvent, {
          ...defaults,
          variant: "second_exit",
        }),
      ),
    ).toBe(true);
    expect(
      auditIsStale(
        a,
        inspectionContext(initialEvent, {
          ...defaults,
          settings: { ...defaults.settings, main_gate_width_m: 2 },
        }),
      ),
    ).toBe(true);
    expect(
      auditIsStale(
        a,
        inspectionContext(initialEvent, { ...defaults, seed: 42 }),
      ),
    ).toBe(false);
  });
});
