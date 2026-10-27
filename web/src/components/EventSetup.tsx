import { labels, type Request } from "../types";
import { fmt } from "../model";
import type { EventInfo } from "../planning";
export function EventSetup({
  event,
  onChange,
  request,
}: {
  event: EventInfo;
  request: Request;
  onChange: (v: EventInfo) => void;
}) {
  return (
    <section
      id="event-setup"
      className="planner-panel"
      aria-labelledby="event-title"
    >
      <h2 id="event-title">Event Setup</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          Event name (optional)
          <input
            className="field"
            maxLength={160}
            value={event.name}
            onChange={(e) => onChange({ ...event, name: e.target.value })}
          />
        </label>
        <label>
          Event type
          <select
            className="field"
            value={event.type}
            onChange={(e) => onChange({ ...event, type: e.target.value })}
          >
            {[
              "Community Puja",
              "Temple gathering",
              "Local fair",
              "College festival",
              "Community celebration",
              "Other temporary event",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Arrival source
          <select
            className="field"
            value={event.arrivalSource}
            onChange={(e) =>
              onChange({
                ...event,
                arrivalSource: e.target.value as EventInfo["arrivalSource"],
              })
            }
          >
            <option>Synthetic demonstration</option>
            <option>Organizer estimate</option>
          </select>
        </label>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 mt-4">
        <div>
          <dt>Expected visitors</dt>
          <dd>
            {Number.isInteger(request.count)
              ? request.count
              : "Enter a valid count"}
          </dd>
        </div>
        <div>
          <dt>Selected scenario</dt>
          <dd>{labels[request.variant]}</dd>
        </div>
        <div>
          <dt>Expected arrival period</dt>
          <dd>
            {Number.isFinite(request.settings.arrival_end_s)
              ? `${fmt(request.settings.arrival_end_s / 60, 3)} min`
              : "Enter a valid period"}
          </dd>
        </div>
      </dl>
      <p>
        Departure assumption:{" "}
        {request.variant === "second_exit"
          ? "Additional exit plus assigned routes"
          : "Main exit only"}
        . Arrival and gate inputs below remain synthetic assumptions.
      </p>
      <p>
        Synthetic demonstration venue — not a surveyed real event site. Two
        entry streams, three service queues; departure gates depend on the
        selected plan. Event name and type are descriptive only.
      </p>
      <p>
        Organizer estimates are unvalidated assumptions. Measured
        registration/attendance CSV import is planned and unavailable in this
        prototype.
      </p>
    </section>
  );
}
