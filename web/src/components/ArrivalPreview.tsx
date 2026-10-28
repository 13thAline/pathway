import { arrivalPreview } from "../arrivals";
import { fmt } from "../model";
import type { Request, Loaded } from "../types";
export function ArrivalPreview({
  request,
  selected,
}: {
  request: Request;
  selected: Loaded | null;
}) {
  const p = arrivalPreview(request);
  return (
    <section
      id="visitor-arrivals"
      className="planner-panel"
      aria-labelledby="arrival-title"
    >
      <h2 id="arrival-title">Visitor Arrivals</h2>
      <p>Estimated arrival distribution based on current assumptions.</p>
      {!p ? (
        <p role="status">
          Enter valid visitor and arrival settings to preview demand.
        </p>
      ) : (
        <>
          <p>
            <strong>{request.count} expected visitors</strong> over{" "}
            {fmt(p.totalMinutes, 3)} minutes.
          </p>
          <div
            className="arrival-chart"
            role="img"
            aria-label={`${p.approximate ? "Approximately " : ""}${fmt(p.peak)} visitors in the first ${fmt(p.peakMinutes, 3)} minutes; ${fmt(p.tail)} in the remaining window.`}
          >
            <span style={{ flex: p.peak || 0.001 }} />
            <span style={{ flex: p.tail || 0.001 }} />
          </div>
          <ul>
            <li>
              {p.approximate ? "Approximately " : ""}
              {fmt(p.peak)} in the first {fmt(p.peakMinutes, 3)} min.
            </li>
            <li>
              {p.approximate ? "Approximately " : ""}
              {fmt(p.tail)} during the following{" "}
              {fmt(p.totalMinutes - p.peakMinutes, 3)} min.
            </li>
          </ul>
          <p>
            {p.approximate
              ? "Staggering samples all visitors uniformly across the full period. Segment counts are theoretical expectations, not realized arrivals."
              : "Exact allocated visitor counts use the engine’s integer splits; times are sampled uniformly within each window."}{" "}
            Bar lengths represent visitor share, not time.
          </p>
          {selected && (
            <p>
              Recorded run: {selected.replay.ledger.at(-1)?.scheduled_by_time}{" "}
              simulated arrivals observed by{" "}
              {fmt(selected.replay.summary.simulated_time_s)} s;{" "}
              {selected.replay.summary.population.future} still scheduled for
              later. The replay does not contain individual generated arrival
              times.
            </p>
          )}
        </>
      )}
    </section>
  );
}
