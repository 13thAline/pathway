import { explainDecision } from "../decision";
import type { Loaded } from "../types";
export function DecisionSummary({
  selected,
  reference,
}: {
  selected: Loaded | null;
  reference: Loaded | null;
}) {
  const d = selected ? explainDecision(selected, reference) : null;
  return (
    <section
      id="plan-comparison"
      className="planner-panel"
      aria-labelledby="decision-title"
    >
      <h2 id="decision-title">Plan Comparison</h2>
      <p>
        Pin the current result, select another plan and load or run it. Compare
        maps to view both replays. Interpretations use selected minus pinned
        measurements.
      </p>
      {!d ? (
        <p>No result selected. Load a result matching the current inputs.</p>
      ) : (
        <>
          <ul>
            {d.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <h3>Suggested human review</h3>
          <ul>
            {d.actions.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
