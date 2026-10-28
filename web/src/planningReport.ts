import type { Audit } from "./accessibility";
import {
  auditIsStale,
  GUIDE,
  GUIDE_NAME,
  inspectAccessibility,
} from "./accessibility";
import type { EventInfo } from "./planning";
import { inspectionContext } from "./planning";
import type { Loaded } from "./types";
import { labels } from "./types";
import { escapeHtml as esc, fmt } from "./model";
import { arrivalPreview } from "./arrivals";
import { explainDecision } from "./decision";
export type PlanningEvidence = {
  event: EventInfo;
  audit: Audit;
  context: string;
};
export function planningReportSections(
  current: Loaded,
  reference: Loaded | null,
  evidence?: PlanningEvidence,
): { overview: string; review: string } {
  const r = current.replay,
    p = arrivalPreview(r.request),
    decision = explainDecision(current, reference);
  const list = (items: string[]) =>
    `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const event = evidence?.event;
  const findings = evidence ? inspectAccessibility(evidence.audit) : [];
  const stale =
    evidence &&
    (auditIsStale(evidence.audit, evidence.context) ||
      auditIsStale(
        evidence.audit,
        inspectionContext(evidence.event, r.request),
      ));
  const actions: string[] = [];
  if (stale)
    actions.push(
      "First verify context: this inspection belongs to a different event/layout.",
    );
  for (const status of [
    "Insufficient information",
    "Requires review",
    "Not inspected",
  ]) {
    for (const f of findings.filter((f) => f.status === status)) {
      actions.push(
        `${status === "Not inspected" ? "Record missing evidence" : "Review recorded issue"} — ${f.name}: ${f.action}`,
      );
    }
  }
  actions.push(...decision.actions);
  const s = r.request.settings;
  return {
    overview: `<h2>Event Overview</h2><p>${esc(event?.name || "Unnamed event")} · ${esc(event?.type || "Community Puja")} · ${r.request.count} expected visitors</p><p>Report created: ${esc(new Date().toISOString())}. Synthetic demonstration venue — not a surveyed real event site.</p><p>Arrival source: ${esc(event?.arrivalSource || "Synthetic demonstration")}; manually entered estimates are unvalidated.</p><h2>Input Assumptions</h2><p>Plan: ${esc(labels[r.request.variant])}. ${p ? `${p.approximate ? "Approximate expected" : "Exact allocated"} arrivals: ${fmt(p.peak)} in first ${fmt(p.peakMinutes, 3)} min; ${fmt(p.tail)} in next ${fmt(p.totalMinutes - p.peakMinutes, 3)} min.` : "Arrival preview unavailable."}</p><p>Two entry streams; three service queues; fixed assigned routes. Main departure gate ${fmt(s.main_gate_width_m)} m; second departure gate ${r.request.variant === "second_exit" ? `${fmt(s.second_gate_width_m)} m open` : "closed"}. Walking speeds ${fmt(s.speed_m_s[0])}–${fmt(s.speed_m_s[1])} m/s; service duration ${fmt(s.service_s[0])}–${fmt(s.service_s[1])} s. These are model assumptions, not surveyed accessible entrance widths.</p><p>Recorded simulated arrivals observed: ${r.ledger.at(-1)?.scheduled_by_time}; future demand: ${r.summary.population.future}. ${r.summary.all_arrivals_observed ? "All scheduled arrivals were observed." : "Some scheduled arrivals were not observed."}</p>`,
    review: `<h2>Decision explanations</h2>${reference ? `<p>Pinned ${esc(labels[reference.replay.request.variant])} versus selected ${esc(labels[r.request.variant])}.</p>` : "<p>Comparison unavailable: no reference selected.</p>"}${list(decision.findings)}<h2>Accessibility Inspection</h2><p>Separate manually reported observations; walking trajectories do not demonstrate wheelchair access. This inspection is not included in the simulation manifest or hashes.</p>${evidence ? `<p>Inspection ${esc(evidence.audit.id)} · ${esc(evidence.audit.inspectedAt)} · event: ${esc(evidence.audit.eventName || "Unnamed event")} · inspector: ${esc(evidence.audit.inspector || "Not supplied")} · location: ${esc(evidence.audit.location || "Not supplied")}</p><p>${stale ? "REQUIRES REVIEW — event or layout context changed." : "Inspection context matches the selected event/layout assumptions."}</p><p>Notes: ${esc(evidence.audit.notes)}</p>${findings.map((f) => `<article><h3>${esc(f.name)} — ${esc(f.status)}</h3><p>${esc(f.value)}. ${esc(f.explanation)}</p><p>${esc(f.action)} <a href="${f.source}">${esc(f.section)}</a></p></article>`).join("")}` : "<p>Not inspected. No manual audit was supplied.</p>"}<h2>Organizer Review Checklist</h2><p>Review context and recorded issues first, then collect missing observations and assess scenario feasibility.</p>${list(actions)}<h2>Evidence and Attribution</h2><p>Simulation engine: Pathway with JuPedSim. Recorded packages: ${esc(JSON.stringify(r.manifest.environment.packages))}. Browser: React, TypeScript and Vite. See repository THIRD_PARTY_NOTICES.md for licenses.</p><p><a href="${GUIDE}">${esc(GUIDE_NAME)}</a>. Only selected checks are represented; consult the complete guidance and local professionals.</p><p>Conceptual research supplied by the project owner: Anuj Nautiyal and Dr. Amit Agarwal (IIT Roorkee), “Transforming Registration Data into Activity-Based Travel Demand: A Reproducible Framework for Planning Large-Scale Pilgrimage Mobility”; Ashish Ranjan (SPA Bhopal), “Regulated versus Unregulated Pedestrian Flow at a Mega-Pilgrimage Node: A LOS Analysis of the Mahakaleshwar Temple Precinct, Ujjain”. Poster attribution/context is user-supplied and not independently verified. This software does not reproduce those studies or assign LOS grades.</p><h2>Planning Limitations</h2>${list(["Synthetic scenarios are not verified real-world forecasts.", "Accessibility observations are manually reported and require site verification.", "The pedestrian model does not simulate all mobility conditions.", "Results do not certify safety, capacity or evacuation performance.", "Use local verification and professional judgment; this is early planning decision support."])}`,
  };
}
