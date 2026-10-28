import { exposureFindings } from "../analyticsComparison";
import { useEffect, useMemo, useState } from "react";
import type { Loaded } from "../types";
import {
  analyticalCsv,
  crowdFindings,
  densityColor,
  densityMaximum,
  lowSpeedIntervals,
  numberLabel as n,
  sampleAt,
  zoneLabel,
  zoneSeries,
  type Series,
} from "../analytics";
import { comparisonReason, download, frameAt } from "../model";
import { heatmapSvg } from "../chartSvg";
import { Venue } from "../Venue";
import { Timeline } from "./AnalyticsCharts";
import { ComparisonCharts } from "./ComparisonCharts";
export function CrowdPatterns({
  selected,
  reference,
  time,
  onTime,
}: {
  selected: Loaded | null;
  reference: Loaded | null;
  time: number;
  onTime: (t: number) => void;
}) {
  return (
    <section
      id="crowd-patterns"
      className="planner-panel crowd-patterns"
      aria-labelledby="patterns-title"
    >
      <h2 id="patterns-title">Crowd Patterns</h2>
      <p>
        Explore where simulated people accumulate, when movement slows and how
        alternatives differ. These measurements support human review; they do
        not estimate accident probability.
      </p>
      {selected ? (
        <AvailablePatterns
          key={selected.envelope.sha256}
          selected={selected}
          reference={reference}
          time={time}
          onTime={onTime}
        />
      ) : (
        <p>
          No matching result selected. Load or run a scenario to view crowd
          charts.
        </p>
      )}
    </section>
  );
}
function AvailablePatterns({
  selected,
  reference,
  time,
  onTime,
}: {
  selected: Loaded;
  reference: Loaded | null;
  time: number;
  onTime: (t: number) => void;
}) {
  const r = selected.replay;
  const ids = Object.keys(r.summary.zones);
  const [zone, setZone] = useState(
    ids.includes("service_queue") ? "service_queue" : (ids[0] ?? ""),
  );
  const [mode, setMode] = useState<
    "density" | "peak_density_per_m2" | "sampled_person_s" | "sampled_slow_s"
  >("density");
  const allSeries = useMemo(
    () => Object.fromEntries(ids.map((id) => [id, zoneSeries(r, id)])),
    [r],
  );
  const rows = allSeries[zone] ?? [];
  const compatible =
    reference && !comparisonReason(reference.replay.summary, r.summary)
      ? reference.replay
      : undefined;
  const refRows = useMemo(
    () => (compatible ? zoneSeries(compatible, zone) : []),
    [compatible, zone],
  );
  const end = Math.max(
    r.summary.simulated_time_s,
    compatible?.summary.simulated_time_s ?? 0,
  );
  useEffect(() => {
    if (time > end) onTime(end);
  }, [time, end, onTime]);
  const cadence = r.summary.measurement.sample_interval_s;
  const current = sampleAt(rows, time, cadence, r.summary.simulated_time_s);
  const snapshot = frameAt(
    r.frames,
    Math.min(time, r.summary.simulated_time_s),
  );
  const refCurrent = compatible
    ? sampleAt(refRows, time, cadence, compatible.summary.simulated_time_s)
    : null;
  const maxDensity = densityMaximum(r, compatible);
  const modes = {
    density: { label: "Density at observation time", unit: "people/m²" },
    peak_density_per_m2: {
      label: "Peak sampled density over run",
      unit: "people/m²",
    },
    sampled_person_s: {
      label: "Accumulated exposure over run",
      unit: "person-s",
    },
    sampled_slow_s: {
      label: "Occupied low-speed duration over run",
      unit: "s",
    },
  };
  const maximum =
    mode === "density"
      ? maxDensity
      : Math.max(
          0,
          ...[r, compatible].flatMap((run) =>
            run ? Object.values(run.summary.zones).map((z) => z[mode]) : [],
          ),
        );
  const mapValue =
    mode === "density"
      ? (current?.density ?? null)
      : (r.summary.zones[zone]?.[mode] ?? null);
  const refMapValue =
    mode === "density"
      ? (refCurrent?.density ?? null)
      : (compatible?.summary.zones[zone]?.[mode] ?? null);
  const metricSeries = (metric: "density" | "speed"): Series[] => [
    {
      name: "Selected plan",
      color: "#6d28d9",
      points: rows.map((row) => ({ t: row.t, value: row[metric] })),
    },
    ...(compatible
      ? [
          {
            name: "Pinned reference",
            color: "#147d92",
            dashed: true,
            points: refRows.map((row) => ({ t: row.t, value: row[metric] })),
          },
        ]
      : []),
  ];
  const populationSeries = (
    keys: {
      key:
        | "active"
        | "waiting_outside"
        | "queued"
        | "serving"
        | "future"
        | "completed"
        | "scheduled_by_time";
      label: string;
      color: string;
      dashed?: boolean;
    }[],
  ): Series[] =>
    keys.map((k) => ({
      name: k.label,
      color: k.color,
      dashed: k.dashed,
      points: r.ledger.map((row) => ({ t: row.time_s, value: row[k.key] })),
    }));
  const seek = (t: number) => onTime(Math.max(0, Math.min(end, t)));
  const findings = useMemo(
    () => [
      ...crowdFindings(r),
      ...(reference ? exposureFindings(selected, reference) : []),
    ],
    [r, selected, reference],
  );
  return (
    <>
      <p className="analytics-provenance">
        {selected.origin === "example"
          ? "Saved synthetic demonstration"
          : selected.origin === "local"
            ? "Fresh local simulation"
            : "Imported recorded data"}{" "}
        · {r.manifest.status.replaceAll("_", " ")} · observed through{" "}
        {n(r.summary.simulated_time_s)} s. {r.summary.population.future} future
        arrivals; {n(r.summary.metrics.unfinished_count)} unfinished visitors.
      </p>
      <div className="crowd-cards">
        {findings.map((f) => (
          <button
            key={f.text}
            className="crowd-card"
            onClick={() => {
              setZone(f.zone);
              if (f.mode) setMode(f.mode);
              if (f.time !== undefined) seek(f.time);
            }}
          >
            {f.text}
            <span>Inspect zone →</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Monitored zone
          <select
            aria-label="Monitored zone"
            className="field"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {ids.map((id) => (
              <option key={id} value={id}>
                {zoneLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Crowding map measurement
          <select
            aria-label="Crowding map measurement"
            className="field"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            {Object.entries(modes).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Only the selected measurement zone is filled. Click a zone on the map or
        use the selector; repeated clicks cycle overlapping regions. Fill is a
        zone average, not a fine spatial heatmap.
      </p>
      <div className={`crowd-maps ${compatible ? "crowd-maps-paired" : ""}`}>
        <figure>
          <figcaption>
            Selected plan · {zoneLabel(zone)} · {n(mapValue)} {modes[mode].unit}
          </figcaption>
          <div className="crowd-map">
            <Venue
              scenario={r.scenario}
              frame={
                mode === "density" && time <= r.summary.simulated_time_s
                  ? snapshot
                  : null
              }
              zones
              zoneOverlay={{ id: zone, value: mapValue, maximum }}
              onZoneSelect={setZone}
              label={`Crowding map: ${zoneLabel(zone)}, ${n(mapValue)} ${modes[mode].unit}`}
            />
          </div>
        </figure>
        {compatible && (
          <figure>
            <figcaption>
              Pinned reference · {n(refMapValue)} {modes[mode].unit}
            </figcaption>
            <div className="crowd-map">
              <Venue
                scenario={compatible.scenario}
                frame={
                  mode === "density" &&
                  time <= compatible.summary.simulated_time_s
                    ? frameAt(compatible.frames, time)
                    : null
                }
                zones
                zoneOverlay={{ id: zone, value: refMapValue, maximum }}
                onZoneSelect={setZone}
                label="Pinned crowding map"
              />
            </div>
          </figure>
        )}
      </div>
      <div className="density-legend" aria-label="Crowding map colour legend">
        <span>0 {modes[mode].unit}</span>
        <span
          className="density-gradient"
          style={{
            background: `linear-gradient(to right,${densityColor(0, maximum)},${densityColor(maximum, maximum)})`,
          }}
        />
        <span>
          {n(maximum)} {modes[mode].unit}
        </span>
        <span className="missing-swatch" />
        Unavailable
      </div>
      <p>
        Scale is relative to displayed{" "}
        {compatible ? "selected and pinned runs" : "run"}, not a safety
        classification.{" "}
        {mode === "density"
          ? "Density uses the latest available analytical sample at the cursor."
          : "Whole-run summary: regions can peak at different times; this is not simultaneous occupancy."}
      </p>
      <label>
        Observation time (seconds)
        <input
          aria-label="Crowd observation time"
          type="range"
          min={0}
          max={end}
          step="any"
          value={Math.min(time, end)}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </label>
      <label>
        Exact observation time (seconds)
        <input
          className="field observation-number"
          aria-label="Exact crowd observation time"
          type="number"
          min={0}
          max={end}
          step="any"
          value={time}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value)) seek(value);
          }}
        />
      </label>
      <p className="observation-status" aria-live="polite">
        Cursor {n(time)} s · analytical sample{" "}
        {current ? `${n(current.t)} s` : "unavailable"} · held pedestrian frame{" "}
        {n(snapshot.t)} s. Density {n(current?.density)} people/m²; mean speed{" "}
        {n(current?.speed)} m/s; count {n(current?.count, 0)}.
      </p>
      <div className="zone-timelines">
        <Timeline
          onTime={seek}
          spec={{
            title: `${zoneLabel(zone)} — density`,
            unit: "people/m²",
            series: metricSeries("density"),
            end,
            max: maxDensity,
            cadence,
            cursor: time,
            bands: lowSpeedIntervals(
              rows,
              cadence,
              r.summary.measurement.slow_speed_m_s,
            ),
          }}
        />
        <Timeline
          onTime={seek}
          spec={{
            title: `${zoneLabel(zone)} — mean movement speed`,
            unit: "m/s",
            series: metricSeries("speed"),
            end,
            cadence,
            cursor: time,
          }}
        />
      </div>
      <p>
        Click a timeline to move the replay, or use the observation slider with
        the keyboard. Analytical samples: {n(cadence)} s; pedestrian display
        frames: {n(r.display.sample_interval_s)} s. Blank line segments indicate
        unavailable speed or sample gaps. Shading marks selected occupied
        intervals below mean speed {n(r.summary.measurement.slow_speed_m_s)}{" "}
        m/s, held until the next sample. This diagnostic is not a safety limit;
        service queues can intentionally wait.
      </p>
      <details>
        <summary>Selected zone sample table</summary>
        <div className="table-scroll sample-table">
          <table>
            <caption>{zoneLabel(zone)} — original recorded samples</caption>
            <thead>
              <tr>
                <th>Time (s)</th>
                <th>Count</th>
                <th>Density (people/m²)</th>
                <th>Mean speed (m/s)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.t}>
                  <td>{n(row.t)}</td>
                  <td>{row.count}</td>
                  <td>{n(row.density)}</td>
                  <td>{n(row.speed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <h3>Density across zones and time</h3>
      <p>
        Each cell shows the maximum recorded density in its time window, with
        the peak sample retained. Hover for window, timestamp and sample count;
        click to inspect it. Grey means no recorded samples. A coloured window
        may have incomplete coverage; it does not establish density between
        samples. Use the zone selector, slider or original table for keyboard
        access.
      </p>
      <div
        className="chart-scroll"
        onClick={(e) => {
          const cell = (e.target as Element).closest("[data-zone]");
          if (cell) {
            setZone(cell.getAttribute("data-zone")!);
            seek(Number(cell.getAttribute("data-time")));
          }
        }}
        dangerouslySetInnerHTML={{ __html: heatmapSvg(r, maxDensity, time) }}
      />
      <div className="density-legend">
        <span>
          Density scale: 0–{n(maxDensity)} people/m², shared with the density
          map and timelines.
        </span>
      </div>
      <Timeline
        onTime={seek}
        spec={{
          title: "People inside and waiting",
          unit: "people",
          series: populationSeries([
            { key: "active", label: "Inside (total)", color: "#6d28d9" },
            {
              key: "waiting_outside",
              label: "Waiting outside",
              color: "#b45309",
              dashed: true,
            },
            { key: "queued", label: "Queued inside", color: "#147d92" },
            {
              key: "serving",
              label: "In service",
              color: "#334155",
              dashed: true,
            },
          ]),
          end: r.summary.simulated_time_s,
          cadence,
          cursor: time,
        }}
      />
      <p>
        Queued and in-service people are subsets of the inside population. Lines
        are separate and must not be added or stacked.
      </p>
      <Timeline
        onTime={seek}
        spec={{
          title: "Arrival and journey accounting",
          unit: "people",
          series: populationSeries([
            {
              key: "future",
              label: "Future arrivals",
              color: "#b45309",
              dashed: true,
            },
            {
              key: "scheduled_by_time",
              label: "Arrivals observed",
              color: "#147d92",
            },
            { key: "completed", label: "Completed journeys", color: "#6d28d9" },
          ]),
          end: r.summary.simulated_time_s,
          cadence,
          cursor: time,
        }}
      />
      <p>
        Arrivals observed means scheduled arrivals reached by that time,
        including outside waiting; it is not an admissions count. Curves stop at
        the actual recorded end, including partial runs.
      </p>
      <details>
        <summary>Population sample table</summary>
        <div className="table-scroll sample-table">
          <table>
            <thead>
              <tr>
                <th>Time (s)</th>
                <th>Inside</th>
                <th>Outside</th>
                <th>Queued</th>
                <th>Serving</th>
                <th>Future</th>
                <th>Completed</th>
                <th>Arrivals observed</th>
              </tr>
            </thead>
            <tbody>
              {r.ledger.map((row) => (
                <tr key={row.time_s}>
                  <td>{n(row.time_s)}</td>
                  <td>{row.active}</td>
                  <td>{row.waiting_outside}</td>
                  <td>{row.queued}</td>
                  <td>{row.serving}</td>
                  <td>{row.future}</td>
                  <td>{row.completed}</td>
                  <td>{row.scheduled_by_time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <ComparisonCharts selected={selected} reference={reference} />
      <button
        className="secondary"
        onClick={() =>
          download(
            `sahajyatra-${r.manifest.scenario_sha256.slice(0, 10)}-zone-samples.csv`,
            analyticalCsv(r),
            "text/csv",
          )
        }
      >
        Download crowd measurements CSV
      </button>
      <p>
        Charts and original samples are included in the planning HTML report.
        Overlapping zone exposures must not be summed. Inspect physical
        accessibility separately.
      </p>
    </>
  );
}
