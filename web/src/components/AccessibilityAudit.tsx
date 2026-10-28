import { useState } from "react";
import {
  auditIsStale,
  GUIDE,
  GUIDE_NAME,
  inspectAccessibility,
  measurementChecks,
  qualitativeChecks,
  newAudit,
  parseAudit,
  type Audit,
  type MeasurementKey,
  type QualitativeKey,
  type InspectionAnswer,
} from "../accessibility";
import { download } from "../model";
export function AccessibilityAudit({
  audit,
  onChange,
  context,
  eventName,
}: {
  audit: Audit;
  onChange: (v: Audit) => void;
  context: string;
  eventName: string;
}) {
  const [error, setError] = useState("");
  const change = (patch: Partial<Audit>) =>
    onChange({ ...audit, ...patch, inspectedAt: new Date().toISOString() });
  const stale = auditIsStale(audit, context);
  const findings = inspectAccessibility(audit);
  const valid = !findings.some((f) => f.status === "Insufficient information");
  return (
    <section
      id="accessibility-inspection"
      className="planner-panel"
      aria-labelledby="audit-title"
    >
      <h2 id="audit-title">Accessibility Inspection</h2>
      <p>
        Manual observations, separate from simulated walking pedestrians. Values
        are not inferred from synthetic gate widths. No overall accessibility
        certification is produced.
      </p>
      <p>
        <a href={GUIDE} target="_blank" rel="noreferrer">
          {GUIDE_NAME}
        </a>
        . Use the complete guide for ramps, landings, handrails, tactile
        guidance, facilities and volunteer preparation.
      </p>
      {stale && (
        <div role="status" className="review-message">
          Event or layout context changed. This inspection belongs to “
          {audit.eventName || "Unnamed event"}” and requires review. Start a new
          inspection or verify every existing observation for this context.
          <button
            className="secondary"
            onClick={() => change({ context, eventName })}
          >
            Confirm observations reviewed for current context
          </button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Inspector name or role (optional)
          <input
            className="field"
            maxLength={160}
            value={audit.inspector}
            onChange={(e) => change({ inspector: e.target.value })}
          />
        </label>
        <label>
          Route or location inspected
          <input
            className="field"
            maxLength={300}
            value={audit.location}
            onChange={(e) => change({ location: e.target.value })}
          />
        </label>
      </div>
      <fieldset>
        <legend>Measured dimensions (metres)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.entries(measurementChecks).map(([id, c]) => (
            <label key={id}>
              {c.name} (m)
              <input
                className="field"
                aria-label={`${c.name} (m)`}
                type="number"
                min="0"
                step="0.01"
                value={
                  Number.isNaN(audit.measurements[id as MeasurementKey])
                    ? ""
                    : (audit.measurements[id as MeasurementKey] ?? "")
                }
                onChange={(e) =>
                  change({
                    measurements: {
                      ...audit.measurements,
                      [id]:
                        e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
              />
              <span className="block">
                Blank means unmeasured; zero is a recorded value.
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Observed route conditions</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(qualitativeChecks).map(([id, c]) => (
            <label key={id}>
              {c.name}
              <select
                aria-label={c.name}
                className="field"
                value={audit.observations[id as QualitativeKey]}
                onChange={(e) =>
                  change({
                    observations: {
                      ...audit.observations,
                      [id]: e.target.value as InspectionAnswer,
                    },
                  })
                }
              >
                <option value="not_inspected">Not inspected</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Inspection notes (optional)
        <textarea
          className="field audit-notes"
          maxLength={5000}
          value={audit.notes}
          onChange={(e) => change({ notes: e.target.value })}
        />
      </label>
      <div className="inspection-findings" aria-live="polite">
        {findings.map((f) => (
          <article
            key={f.id}
            className={
              f.status === "Requires review" ||
              f.status === "Insufficient information"
                ? "review-message"
                : ""
            }
          >
            <h3>
              {f.name} — {f.status}
            </h3>
            <p>
              {f.value}. {f.explanation}
            </p>
            <p>
              {f.action}{" "}
              <a href={f.source} target="_blank" rel="noreferrer">
                Source: {f.section}
              </a>
            </p>
          </article>
        ))}
      </div>
      <p>
        Inspection {audit.id} · last recorded{" "}
        {new Date(audit.inspectedAt).toLocaleString()} · manually reported.
        Export to retain this inspection between visits.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="secondary"
          disabled={!valid}
          onClick={() =>
            download(
              "sahajyatra-inspection.json",
              JSON.stringify(parseAudit(audit), null, 2),
            )
          }
        >
          Export inspection JSON
        </button>
        <label className="secondary">
          Import inspection JSON
          <input
            aria-label="Import inspection JSON"
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 100000)
                  throw Error("Inspection exceeds 100 KB.");
                onChange(parseAudit(JSON.parse(await file.text())));
                setError("");
              } catch (err) {
                setError(String(err));
              }
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="secondary"
          onClick={() => {
            onChange(newAudit(context, eventName));
            setError("");
          }}
        >
          Start new / reset inspection
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
