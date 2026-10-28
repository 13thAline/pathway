export const GUIDE =
  "https://india.un.org/sites/default/files/2025-10/English%20SOP%20.pdf";
export const GUIDE_NAME =
  "UN India / UNESCO / IIT Kharagpur, 2025 — Durga Puja accessibility guide";
export const measurementChecks = {
  aisle: {
    name: "Dedicated internal accessible aisle",
    minimum: 1.5,
    section: "2.4(a), printed p.20",
    page: 32,
    guidance:
      "Separate aisle: 1.5 m minimum; inspect pinch points and encroachment too.",
  },
  entrance: {
    name: "Clear accessible entrance width",
    minimum: 1.0,
    section: "2.3(c–d), printed p.19",
    page: 31,
    guidance:
      "Clear entrance: at least 1.0 m, preferably 1.5 m; check location and separation.",
  },
  turning: {
    name: "Manoeuvring clearance at turning points",
    minimum: 1.2,
    section: "2.4(b), printed p.20",
    page: 32,
    guidance:
      "At least 1.2 m at doorways and turns; inspect ramp landings separately.",
  },
} as const;
export const qualitativeChecks = {
  stepFree: {
    name: "Continuous step-free route",
    section: "2.3(a), 2.4(b), printed pp.18–20",
    page: 30,
    guidance: "Check continuity and ramp suitability at level changes.",
  },
  unobstructed: {
    name: "Obstruction-free circulation",
    section: "2.4(a,d,e), printed pp.20–22",
    page: 32,
    guidance: "Inspect projections and temporary encroachment along the route.",
  },
  surface: {
    name: "Suitable non-slip surface",
    section: "2.4(c), printed pp.20–21",
    page: 32,
    guidance: "Inspect flooring and transitions for mobility aids.",
  },
  identified: {
    name: "Accessible entrance identified",
    section: "2.3(c), printed p.19",
    page: 31,
    guidance: "Check entrance identification and accessibility symbol.",
  },
  signage: {
    name: "Clear directional signage",
    section: "2.8, printed pp.30–34",
    page: 42,
    guidance: "Review legibility, placement and wayfinding with users.",
  },
  resting: {
    name: "Appropriate resting area available",
    section: "2.4(g), 2.6, printed pp.23,25–26",
    page: 35,
    guidance:
      "Review route length, resting needs and seating provision together.",
  },
} as const;
export type MeasurementKey = keyof typeof measurementChecks;
export type QualitativeKey = keyof typeof qualitativeChecks;
export type InspectionAnswer = "yes" | "no" | "not_inspected";
export type Audit = {
  schemaVersion: 1;
  id: string;
  eventName: string;
  inspectedAt: string;
  manuallyReported: true;
  inspector: string;
  location: string;
  context: string;
  notes: string;
  guideline: typeof GUIDE;
  measurements: Record<MeasurementKey, number | null>;
  observations: Record<QualitativeKey, InspectionAnswer>;
};
export type Finding = {
  id: string;
  name: string;
  value: string;
  status:
    | "Meets this specific measurement check"
    | "Reported yes"
    | "Requires review"
    | "Not inspected"
    | "Insufficient information";
  section: string;
  source: string;
  explanation: string;
  action: string;
};
export function newAudit(context: string, eventName: string): Audit {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    eventName,
    inspectedAt: new Date().toISOString(),
    manuallyReported: true,
    inspector: "",
    location: "",
    context,
    notes: "",
    guideline: GUIDE,
    measurements: { aisle: null, entrance: null, turning: null },
    observations: {
      stepFree: "not_inspected",
      unobstructed: "not_inspected",
      surface: "not_inspected",
      identified: "not_inspected",
      signage: "not_inspected",
      resting: "not_inspected",
    },
  };
}
export function parseAudit(value: unknown): Audit {
  const a = value as Audit;
  if (
    !a ||
    a.schemaVersion !== 1 ||
    a.manuallyReported !== true ||
    a.guideline !== GUIDE ||
    ![
      "id",
      "eventName",
      "inspectedAt",
      "inspector",
      "location",
      "context",
      "notes",
    ].every(
      (k) =>
        typeof a[k as keyof Audit] === "string" &&
        (a[k as keyof Audit] as string).length <= 10000,
    ) ||
    !a.id ||
    !a.context ||
    !Number.isFinite(Date.parse(a.inspectedAt)) ||
    !a.measurements ||
    !a.observations ||
    !Object.keys(measurementChecks).every((k) => {
      const v = a.measurements[k as MeasurementKey];
      return (
        v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0)
      );
    }) ||
    !Object.keys(qualitativeChecks).every((k) =>
      ["yes", "no", "not_inspected"].includes(
        a.observations[k as QualitativeKey],
      ),
    )
  )
    throw Error(
      "Invalid inspection file: check schema, measurements and three-state observations.",
    );
  return a;
}
export const auditIsStale = (audit: Audit, context: string) =>
  audit.context !== context;
export function inspectAccessibility(a: Audit): Finding[] {
  const numeric = Object.entries(measurementChecks).map(
    ([id, check]): Finding => {
      const v = a.measurements[id as MeasurementKey];
      const valid = typeof v === "number" && Number.isFinite(v) && v >= 0;
      return {
        id,
        name: check.name,
        value: v == null ? "Unmeasured" : `${String(v)} m`,
        status:
          v == null
            ? "Not inspected"
            : !valid
              ? "Insufficient information"
              : v < check.minimum
                ? "Requires review"
                : "Meets this specific measurement check",
        section: check.section,
        source: `${GUIDE}#page=${check.page}`,
        explanation: check.guidance,
        action:
          v == null || !valid
            ? "Record a valid on-site measurement in metres."
            : v < check.minimum
              ? "Review this location with an accessibility professional."
              : id === "entrance" && v < 1.5
                ? "Review the preferred 1.5 m entrance provision and other entrance conditions."
                : "Verify the remaining route conditions on site; this width alone is not an accessibility assessment.",
      };
    },
  );
  return [
    ...numeric,
    ...Object.entries(qualitativeChecks).map(([id, check]): Finding => {
      const answer = a.observations[id as QualitativeKey];
      return {
        id,
        name: check.name,
        value:
          answer === "not_inspected"
            ? "Not inspected"
            : answer === "yes"
              ? "Yes (manually reported)"
              : answer === "no"
                ? "No (manually reported)"
                : "Invalid observation",
        status:
          answer === "not_inspected"
            ? "Not inspected"
            : answer === "yes"
              ? "Reported yes"
              : answer === "no"
                ? "Requires review"
                : "Insufficient information",
        section: check.section,
        source: `${GUIDE}#page=${check.page}`,
        explanation: check.guidance,
        action:
          answer === "no"
            ? "Inspect the barrier and discuss an appropriate remedy."
            : "Verify this observation on site with the full guidance.",
      };
    }),
  ];
}
