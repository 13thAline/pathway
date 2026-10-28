import { auditIsStale, inspectAccessibility } from "../accessibility";
import type { Loaded } from "../types";
import type { PlanningEvidence } from "../planningReport";
export function ReportPanel({
  selected,
  reference,
  evidence,
  onDownload,
}: {
  selected: Loaded | null;
  reference: Loaded | null;
  evidence: PlanningEvidence;
  onDownload: () => void;
}) {
  const findings = inspectAccessibility(evidence.audit);
  return (
    <section
      id="planning-report"
      className="planner-panel"
      aria-labelledby="report-title"
    >
      <h2 id="report-title">Planning Report</h2>
      <p>
        {evidence.event.name || "Unnamed event"} · {evidence.event.type}.{" "}
        {selected
          ? `${selected.replay.request.count} visitors · ${selected.replay.manifest.status} · ${selected.origin === "example" ? "saved demonstration" : selected.origin === "file" ? "imported replay" : "fresh local run"}.`
          : "No matching result selected."}
      </p>
      <p>
        {reference
          ? "Pinned reference included; incompatible comparisons are explicitly rejected."
          : "No reference pinned; comparative conclusions unavailable."}{" "}
        {findings.filter((f) => f.status === "Requires review").length}{" "}
        inspection checks require review;{" "}
        {findings.filter((f) => f.status === "Not inspected").length} not
        inspected.
      </p>
      {auditIsStale(evidence.audit, evidence.context) && (
        <p className="review-message">
          Inspection context changed; report will flag observations for review.
        </p>
      )}
      <p>
        Includes input assumptions, computed results, comparison findings,
        separate manual inspection, review checklist, sources and limitations.
        Download HTML, then use your browser’s Print → Save as PDF.
      </p>
      <button className="primary" disabled={!selected} onClick={onDownload}>
        Download planning report
      </button>
    </section>
  );
}
