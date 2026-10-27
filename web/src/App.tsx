import { CrowdPatterns } from "./components/CrowdPatterns";
import {
  minutesToSeconds,
  secondsToMinutes,
  percentageToFraction,
  fractionToPercentage,
} from "./arrivals";
import { EventSetup } from "./components/EventSetup";
import { ArrivalPreview } from "./components/ArrivalPreview";
import { AccessibilityAudit } from "./components/AccessibilityAudit";
import { DecisionSummary } from "./components/DecisionSummary";
import { ReportPanel } from "./components/ReportPanel";
import { initialEvent, inspectionContext } from "./planning";
import { newAudit } from "./accessibility";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowsSplit,
  Check,
  DownloadSimple,
  Flask,
  MapTrifold,
  Pause,
  Play,
  Plus,
  Repeat,
  SlidersHorizontal,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Venue } from "./Venue";
import {
  clock,
  comparisonReason,
  decodeEnvelope,
  delta,
  download,
  fmt,
  frameAt,
  held,
  reportHtml,
  requestKey,
  validateRequest,
} from "./model";
import {
  defaults,
  labels,
  type Job,
  type Loaded,
  type Request,
  type Scenario,
  type Variant,
} from "./types";
const TERMINAL = [
  "succeeded",
  "horizon_reached",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
];
const zoneName = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
async function api(path: string, body?: unknown) {
  const r = await fetch(
    `/api/${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  if (!r.ok) {
    let e;
    try {
      e = (await r.json()).error;
    } catch {
      e = `Local service returned ${r.status}`;
    }
    throw Error(e);
  }
  return r.json();
}
function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number | "any";
  unit?: string;
}) {
  return (
    <label className="block space-y-1.5 text-[11px] font-medium text-stone-600">
      <span>
        {label}
        {unit && (
          <span className="float-right font-normal text-stone-500">{unit}</span>
        )}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : Number(e.target.value))
        }
        className="field"
      />
    </label>
  );
}
function Trend({ loaded, time }: { loaded: Loaded; time: number }) {
  const rows = loaded.replay.ledger,
    max = Math.max(1, ...rows.map((r) => r.active)),
    end = loaded.replay.summary.simulated_time_s || 1;
  const points = rows
    .map((r) => `${(r.time_s / end) * 600},${50 - (r.active / max) * 44}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 600 54"
      preserveAspectRatio="none"
      className="h-12 w-full"
      role="img"
      aria-label={`Inside population over the run, peak ${max}`}
    >
      <polygon points={`0,54 ${points} 600,54`} fill="#e1eadd" />
      <polyline
        points={points}
        fill="none"
        stroke="#66865c"
        strokeWidth="1.6"
      />
      <line
        x1={(time / end) * 600}
        x2={(time / end) * 600}
        y1="0"
        y2="54"
        stroke="#244d35"
        strokeWidth="1.5"
      />
    </svg>
  );
}
export default function App() {
  const [event, setEvent] = useState(initialEvent);
  const [audit, setAudit] = useState(() =>
    newAudit(inspectionContext(initialEvent, defaults), initialEvent.name),
  );
  const [draft, setDraft] = useState<Request>(structuredClone(defaults)),
    [loaded, setLoaded] = useState<Loaded | null>(null),
    [reference, setReference] = useState<Loaded | null>(null),
    [history, setHistory] = useState<Loaded[]>([]);
  const [connection, setConnection] = useState<
      "checking" | "online" | "offline"
    >("checking"),
    [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState<Scenario | null>(null);
  const [time, setTime] = useState(180),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(8),
    [zones, setZones] = useState(false),
    [compare, setCompare] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const fileInput = useRef<HTMLInputElement>(null),
    loadedJobs = useRef(new Set<string>());
  const key = requestKey(draft),
    errors = validateRequest(draft),
    selected =
      loaded && key === requestKey(loaded.replay.request) ? loaded : null,
    stale = !!loaded && !selected;
  const evidence = { event, audit, context: inspectionContext(event, draft) };
  const exportReport = () =>
    selected &&
    download(
      `pathway-${selected.replay.manifest.scenario_sha256.slice(0, 10)}-report.html`,
      reportHtml(selected, reference, evidence),
      "text/html",
    );
  const active = jobs.find((j) => !TERMINAL.includes(j.status)),
    end = selected?.replay.summary.simulated_time_s ?? 0;
  const select = (value: Loaded) => {
    setDraft(structuredClone(value.replay.request));
    setLoaded(value);
    setPlaying(false);
    setTime(Math.min(180, value.replay.summary.simulated_time_s));
    setCompare(false);
    setError("");
  };
  const remember = (value: Loaded) =>
    setHistory((old) =>
      [
        value,
        ...old.filter((x) => x.envelope.sha256 !== value.envelope.sha256),
      ].slice(0, 6),
    );
  const connect = async () => {
    setConnection("checking");
    try {
      const value = await api("bootstrap");
      if (value.service !== "pathway-local-1")
        throw Error("Unsupported local service");
      for (const job of value.jobs as Job[]) {
        if (TERMINAL.includes(job.status)) loadedJobs.current.add(job.id);
      }
      setConnection("online");
      setJobs(value.jobs);
    } catch {
      setConnection("offline");
    }
  };
  const demo = async (variant: Variant) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}demos/${variant}.json`,
      );
      if (!response.ok) throw Error("Saved example could not be loaded.");
      const value = await decodeEnvelope(await response.json(), "example");
      remember(value);
      select(value);
      setNotice("Loaded saved demonstration · 500 visitors · seed 0.");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void connect();
    void demo("baseline");
  }, []);
  useEffect(() => {
    setPlaying(false);
    setPreview(null);
    if (errors.length || connection !== "online" || selected) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
          signal: abort.signal,
        });
        if (response.ok) {
          const value = await response.json();
          setPreview(value.scenario);
        }
      } catch {
        /* Offline geometry is not invented. */
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, connection]);
  useEffect(() => {
    if (connection !== "online") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const list: Job[] = await api("jobs");
        if (stopped) return;
        setJobs(list);
        for (const job of list) {
          if (
            TERMINAL.includes(job.status) &&
            !job.result_available &&
            !loadedJobs.current.has(job.id)
          ) {
            loadedJobs.current.add(job.id);
            const message = `Local run ${job.status.replaceAll("_", " ")}. ${job.message}`;
            if (job.status === "cancelled") setNotice(message);
            else setError(message);
          }
          if (job.result_available && !loadedJobs.current.has(job.id)) {
            loadedJobs.current.add(job.id);
            try {
              const value = await decodeEnvelope(
                await api(`jobs/${job.id}/result`),
                "local",
              );
              if (stopped) return;
              remember(value);
              if (requestKey(draftRef.current) === requestKey(job.request)) {
                setLoaded(value);
                setTime(Math.min(180, value.replay.summary.simulated_time_s));
                setPlaying(false);
                setNotice("Fresh local result loaded.");
              } else
                setNotice(
                  "A local run finished. Open it from recent runs; your edited inputs are preserved.",
                );
            } catch (e) {
              setError(`Could not load local result: ${e}`);
            }
          }
        }
      } catch {
        if (!stopped) {
          setConnection("offline");
          setNotice(
            "Local engine disconnected. Saved results remain available.",
          );
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [connection]);
  useEffect(() => {
    if (!playing || !selected) return;
    let id: number,
      last: number | null = null;
    const tick = (now: number) => {
      if (last !== null)
        setTime((t) => {
          const next = Math.min(
            end,
            t + Math.min((now - last!) / 1000, 0.2) * speed,
          );
          if (next >= end) setPlaying(false);
          return next;
        });
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, end, selected?.envelope.sha256]);
  const update = (change: Partial<Request>) => {
    setDraft((old) => ({ ...old, ...change }));
    setNotice("");
    setPlaying(false);
  };
  const setting = (name: keyof Request["settings"], value: unknown) =>
    update({ settings: { ...draft.settings, [name]: value } });
  const run = async () => {
    if (errors.length) return;
    setSubmitting(true);
    setError("");
    try {
      const job: Job = await api("jobs", draft);
      setJobs((old) => [job, ...old]);
      setNotice(
        "Fresh run queued. Replay will be available when the output is sealed.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };
  const frame = selected ? frameAt(selected.replay.frames, time) : null;
  const row = selected
    ? held(
        selected.replay.ledger.map((x) => ({ ...x, t: x.time_s })),
        frame!.t,
      )
    : null;
  const refFrame = reference
    ? frameAt(
        reference.replay.frames,
        Math.min(time, reference.replay.summary.simulated_time_s),
      )
    : null;
  const reason =
    selected && reference
      ? comparisonReason(reference.replay.summary, selected.replay.summary)
      : null;
  const partial =
    selected && !["succeeded"].includes(selected.replay.manifest.status);
  const loadJob = async (job: Job) => {
    setLoading(true);
    try {
      const value = await decodeEnvelope(
        await api(`jobs/${job.id}/result`),
        "local",
      );
      remember(value);
      select(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="min-h-dvh bg-[#f4f5f1] text-[#27372c]">
      <a href="#workspace" className="skip-link">
        Skip to workspace
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce2d8] bg-[#fbfcf9] px-5 py-4 lg:px-8">
        <a
          href="#"
          className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"
          aria-label="Pathway home"
        >
          <span className="grid size-8 place-items-center rounded-md bg-[#2e563b] text-white">
            <ArrowsSplit size={20} weight="bold" />
          </span>
          Pathway
          <span className="ml-3 hidden border-l border-[#d8dfd2] pl-4 text-[11px] font-normal tracking-normal text-stone-500 sm:inline">
            Event planning workspace
          </span>
        </a>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[11px] text-stone-500">
            <span
              className={`size-1.5 rounded-full ${connection === "online" ? "bg-[#5c8552]" : "bg-stone-400"}`}
            />
            {connection === "online"
              ? "Local engine connected"
              : connection === "checking"
                ? "Connecting to local engine"
                : "Saved replay mode"}
          </span>
          <a
            href="#method"
            className="text-xs underline decoration-stone-300 underline-offset-4"
          >
            About the model
          </a>
        </div>
      </header>
      <main
        id="workspace"
        className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8 lg:py-7"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">WORKSPACE / SYNTHETIC EVENTS</p>
            <h1 className="text-[26px] font-medium tracking-[-.055em] sm:text-[32px]">
              Pathway — Intelligent Event Flow and Accessibility Planning
            </h1>
            <p className="mt-2 text-sm text-[#53604d]">
              Explore visitor arrivals, pedestrian movement, alternative plans
              and manual accessibility observations. Early planning support;
              results do not certify safety or evacuation performance.
            </p>
          </div>
          <span className="flex items-center gap-2 rounded-full border border-[#d6dfcf] bg-[#ecf1e7] px-3 py-1.5 text-[10px] text-[#5a6b50]">
            <Flask size={14} />
            Research prototype · synthetic inputs
          </span>
        </div>
        <nav aria-label="Planning workflow" className="workflow-nav">
          {[
            ["event-setup", "Event Setup"],
            ["visitor-arrivals", "Visitor Arrivals"],
            ["venue-simulation", "Venue Simulation"],
            ["crowd-patterns", "Crowd Patterns"],
            ["plan-comparison", "Plan Comparison"],
            ["accessibility-inspection", "Accessibility Inspection"],
            ["planning-report", "Planning Report"],
          ].map(([id, label], index) => (
            <a key={id} href={`#${id}`}>
              {index + 1}. {label}
            </a>
          ))}
        </nav>
        <div className="flex flex-wrap gap-3 mb-5">
          <a className="primary" href="#event-setup">
            Start planning
          </a>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void demo("baseline")}
          >
            Load saved demonstration
          </button>
        </div>
        <EventSetup event={event} onChange={setEvent} request={draft} />
        <div id="venue-simulation" className="workspace-grid grid gap-5">
          <aside className="min-w-0 overflow-hidden rounded-xl border border-[#dce2d6] bg-[#fbfcf9]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              <div className="flex items-center justify-between border-b border-[#e2e7dd] px-5 py-4">
                <h2 className="flex items-center gap-2 text-xs font-semibold">
                  <SlidersHorizontal size={16} />
                  Venue Simulation
                </h2>
                <span className="eyebrow">01</span>
              </div>
              <div className="space-y-5 px-5 py-5">
                <div>
                  <p className="eyebrow mb-2">EVENT TEMPLATE</p>
                  <div className="flex items-center gap-3 rounded-lg border border-[#dce2d6] bg-[#f1f4ed] p-3">
                    <MapTrifold size={24} className="text-[#638057]" />
                    <div>
                      <p className="text-xs font-medium">
                        Community Puja / pandal
                      </p>
                      <p className="mt-1 text-[10px] text-stone-500">
                        60 × 40 m · two entry streams
                      </p>
                    </div>
                  </div>
                </div>
                <fieldset>
                  <legend className="mb-2.5 text-[11px] font-medium">
                    Event plan
                  </legend>
                  <div className="space-y-1.5">
                    {(
                      ["baseline", "second_exit", "staggered"] as Variant[]
                    ).map((v) => (
                      <label
                        key={v}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 ${draft.variant === v ? "border-[#91aa82] bg-[#eef3e8]" : "border-[#e2e7dd] bg-white"}`}
                      >
                        <input
                          type="radio"
                          name="variant"
                          value={v}
                          checked={draft.variant === v}
                          onChange={() => update({ variant: v })}
                          className="mt-0.5 accent-[#4c7240]"
                        />
                        <span>
                          <span className="block text-xs font-medium">
                            {labels[v]}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-relaxed text-stone-500">
                            {v === "baseline"
                              ? "One main departure gate"
                              : v === "second_exit"
                                ? "Open another gate + assign routes"
                                : "Spread arrivals across the full window"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput
                    label="Total visitors"
                    value={draft.count}
                    onChange={(n) => update({ count: n })}
                    min={1}
                    max={750}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput
                    label="Peak ends"
                    step="any"
                    unit="min"
                    value={secondsToMinutes(draft.settings.peak_end_s)}
                    onChange={(n) => setting("peak_end_s", minutesToSeconds(n))}
                    min={0.001}
                    max={30}
                  />
                  <NumberInput
                    label="Last arrival"
                    step="any"
                    unit="min"
                    value={secondsToMinutes(draft.settings.arrival_end_s)}
                    onChange={(n) =>
                      setting("arrival_end_s", minutesToSeconds(n))
                    }
                    min={0.001}
                    max={30}
                  />
                </div>
                <NumberInput
                  label="Arrivals in peak window"
                  unit="%"
                  value={fractionToPercentage(draft.settings.peak_fraction)}
                  onChange={(n) =>
                    setting("peak_fraction", percentageToFraction(n))
                  }
                  min={0}
                  max={100}
                />
                <ArrivalPreview request={draft} selected={selected} />
                <details className="border-t border-[#e2e7dd] pt-4">
                  <summary className="cursor-pointer text-[11px] font-medium">
                    Advanced: timing & movement
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <NumberInput
                        label="Main exit"
                        unit="m"
                        value={draft.settings.main_gate_width_m}
                        onChange={(n) => setting("main_gate_width_m", n)}
                        min={0}
                        max={4}
                        step={0.1}
                      />
                      <NumberInput
                        label="Second exit"
                        unit="m"
                        value={draft.settings.second_gate_width_m}
                        onChange={(n) => setting("second_gate_width_m", n)}
                        min={0.5}
                        max={4}
                        step={0.1}
                      />
                    </div>
                    <p className="-mt-3 text-[10px] leading-relaxed text-stone-500">
                      Second exit opens only in the additional-exit plan. A
                      width of 0 closes the main gate.
                    </p>
                    <NumberInput
                      label="Random seed"
                      value={draft.seed}
                      onChange={(n) => update({ seed: n })}
                      min={0}
                      max={4294967295}
                    />{" "}
                    <div className="grid grid-cols-2 gap-3">
                      <NumberInput
                        label="Service min"
                        unit="s"
                        value={draft.settings.service_s[0]}
                        onChange={(n) =>
                          setting("service_s", [n, draft.settings.service_s[1]])
                        }
                        min={0}
                        max={600}
                        step={0.1}
                      />
                      <NumberInput
                        label="Service max"
                        unit="s"
                        value={draft.settings.service_s[1]}
                        onChange={(n) =>
                          setting("service_s", [draft.settings.service_s[0], n])
                        }
                        min={0}
                        max={600}
                        step={0.1}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberInput
                        label="Speed min"
                        unit="m/s"
                        value={draft.settings.speed_m_s[0]}
                        onChange={(n) =>
                          setting("speed_m_s", [n, draft.settings.speed_m_s[1]])
                        }
                        min={0.1}
                        max={3}
                        step={0.1}
                      />
                      <NumberInput
                        label="Speed max"
                        unit="m/s"
                        value={draft.settings.speed_m_s[1]}
                        onChange={(n) =>
                          setting("speed_m_s", [draft.settings.speed_m_s[0], n])
                        }
                        min={0.1}
                        max={3}
                        step={0.1}
                      />
                    </div>
                    <NumberInput
                      label="Simulation horizon"
                      unit="s"
                      value={draft.settings.horizon_s}
                      onChange={(n) => setting("horizon_s", n)}
                      min={1}
                      max={3600}
                    />
                    <label className="block text-[11px] font-medium">
                      Timestep (s)
                      <select
                        className="field mt-1.5"
                        value={draft.settings.dt_s}
                        onChange={(e) =>
                          setting("dt_s", Number(e.target.value))
                        }
                      >
                        {[0.005, 0.01, 0.02, 0.05].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <p className="text-[10px] leading-relaxed text-stone-500">
                      Synthetic ranges, not measured event behaviour. Crowded
                      queues are sensitive to timestep. Staggering reschedules
                      visitors; off-site costs are excluded.
                    </p>
                  </div>
                </details>
                {errors.length > 0 && (
                  <div
                    role="alert"
                    className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900"
                  >
                    {errors.map((e) => (
                      <p key={e}>{e}</p>
                    ))}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={
                    connection !== "online" ||
                    errors.length > 0 ||
                    submitting ||
                    !!active
                  }
                  className="primary w-full justify-between"
                >
                  <span>
                    {submitting
                      ? "Submitting…"
                      : active
                        ? "Simulation in progress"
                        : "Run local simulation"}
                  </span>
                  <ArrowRight size={16} />
                </button>
                <p className="-mt-2 text-[10px] leading-relaxed text-stone-500">
                  {connection === "online"
                    ? "Runs on your computer. Larger crowds can take several minutes."
                    : "Fresh simulation needs the local engine. Saved examples work without it."}
                </p>
                {connection !== "online" && (
                  <button
                    type="button"
                    onClick={() => void connect()}
                    className="text-[11px] underline underline-offset-4"
                  >
                    Reconnect local engine
                  </button>
                )}
                <div className="border-t border-[#e2e7dd] pt-4">
                  <p className="eyebrow mb-2">PRESENTATION EXAMPLES</p>
                  <button
                    type="button"
                    onClick={() => void demo(draft.variant)}
                    disabled={loading}
                    className="secondary w-full justify-between"
                  >
                    <span>
                      {loading
                        ? "Loading example…"
                        : `Load saved ${labels[draft.variant].toLowerCase()}`}
                    </span>
                    <Repeat size={14} />
                  </button>
                  <p className="mt-2 text-[10px] text-stone-500">
                    Resets inputs to 500 visitors, seed 0.
                  </p>
                </div>
              </div>
            </form>
          </aside>
          <section className="min-w-0 space-y-4">
            {(error || notice) && (
              <div
                role={error ? "alert" : "status"}
                className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${error ? "border-amber-300 bg-amber-50 text-amber-900" : "border-[#d7e1d0] bg-[#eef3e8] text-[#52654a]"}`}
              >
                <span>{error || notice}</span>
                <button
                  aria-label="Dismiss message"
                  onClick={() => {
                    setError("");
                    setNotice("");
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {active && (
              <div className="rounded-lg border border-[#c9d9bd] bg-[#eaf1e3] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">
                      {active.status === "queued"
                        ? "Queued locally"
                        : active.status === "cancelling"
                          ? "Cancelling run"
                          : "Fresh simulation running"}{" "}
                      · {active.request.count} visitors
                    </p>
                    <p className="mt-1 text-[11px] text-stone-600">
                      {active.message} This is computation, not replay progress.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      void api(`jobs/${active.id}/cancel`, {})
                        .then(() => setNotice("Cancellation requested."))
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#d7e2ce]">
                  <div className="job-progress h-full w-1/3 bg-[#7d9b6b]" />
                </div>
              </div>
            )}
            {stale && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-[#e2d5b4] bg-[#faf5e8] px-4 py-3 text-xs text-[#806230]"
              >
                <WarningCircle size={16} />
                <span>
                  Inputs changed. Previous results are archived; run the updated
                  scenario or reload a saved example. Exports are disabled until
                  inputs match.
                </span>
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-[#dce2d6] bg-[#fbfcf9]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e7dd] px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">
                    Community Puja / pandal
                  </h2>
                  <p className="mt-1 text-[10px] text-stone-500">
                    {selected
                      ? `${labels[selected.replay.request.variant]} · ${selected.replay.request.count} visitors · seed ${selected.replay.request.seed}`
                      : "Edited scenario · preview only"}
                    <span className="mx-2">/</span>metres · seconds
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selected && (
                    <span
                      className={`status-pill ${partial ? "status-partial" : ""}`}
                    >
                      {selected.origin === "file"
                        ? "Imported replay"
                        : selected.origin === "local"
                          ? "Fresh local run"
                          : "Saved replay"}{" "}
                      · {selected.replay.manifest.status.replaceAll("_", " ")}
                    </span>
                  )}
                  <button
                    className="map-toggle"
                    aria-pressed={zones}
                    onClick={() => setZones((x) => !x)}
                  >
                    Zones
                  </button>
                </div>
              </div>
              <div
                className={`grid ${compare && reference && selected ? "md:grid-cols-2" : ""}`}
              >
                {compare && reference && selected && (
                  <div className="border-b border-[#dce2d6] md:border-r md:border-b-0">
                    <p className="bg-[#f0f3eb] px-4 py-2 text-[10px] font-medium">
                      REFERENCE · {labels[reference.replay.request.variant]} ·{" "}
                      {reference.origin === "file"
                        ? "imported"
                        : reference.replay.mode}
                    </p>
                    <div className="map-height">
                      <Venue
                        scenario={reference.replay.scenario}
                        frame={refFrame}
                        zones={zones}
                        label="Reference venue replay"
                      />
                    </div>
                  </div>
                )}
                <div>
                  {compare && reference && selected && (
                    <p className="bg-[#f0f3eb] px-4 py-2 text-[10px] font-medium">
                      SELECTED · {labels[selected.replay.request.variant]} ·{" "}
                      {selected.origin === "file"
                        ? "imported"
                        : selected.replay.mode}
                    </p>
                  )}
                  <div
                    className={`map-height relative ${loading ? "opacity-40" : ""}`}
                  >
                    <Venue
                      scenario={selected?.replay.scenario ?? preview}
                      frame={frame}
                      zones={zones}
                      label={
                        selected
                          ? `Venue replay at ${clock(frame!.t)}`
                          : "Edited venue preview; no results"
                      }
                    />
                    {loading && (
                      <div className="absolute inset-x-0 top-5 mx-auto w-fit rounded-lg bg-white/90 px-5 py-3 text-xs">
                        Loading verified replay…
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#e2e7dd] px-5 py-2.5 text-[10px] text-stone-500">
                <div className="flex gap-4">
                  <span>
                    <i className="legend-dot bg-[#4c7b53]" />
                    Walking
                  </span>
                  <span>
                    <i className="legend-dot bg-[#b67832]" />
                    Queued
                  </span>
                  <span>
                    <i className="legend-dot bg-[#263e30]" />
                    In service
                  </span>
                </div>
                <span>
                  {frame ? `Snapshot ${clock(frame.t)} · ` : ""}every 2 s · no
                  interpolation
                </span>
              </div>
              <div className="p-4 sm:px-5">
                <div className="mb-2 flex items-center justify-between text-[10px] text-stone-500">
                  <span>INSIDE POPULATION</span>
                  <span>
                    {selected
                      ? `${fmt(selected.replay.summary.metrics.peak_active_count, 0)} peak`
                      : "No matching result"}
                  </span>
                </div>
                {selected ? (
                  <Trend loaded={selected} time={Math.min(time, end)} />
                ) : (
                  <div className="h-12 border-b border-dashed border-stone-200" />
                )}
                <input
                  aria-label="Replay time"
                  type="range"
                  min={0}
                  max={end || 1}
                  step={0.001}
                  value={Math.min(time, end)}
                  disabled={!selected}
                  onChange={(e) => {
                    setPlaying(false);
                    setTime(Number(e.target.value));
                  }}
                  className="mt-1 w-full accent-[#55774a]"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      className="play-button"
                      aria-label={playing ? "Pause replay" : "Play replay"}
                      disabled={!selected}
                      onClick={() => {
                        if (time >= end) setTime(0);
                        setPlaying((x) => !x);
                      }}
                    >
                      {playing ? (
                        <Pause size={16} weight="fill" />
                      ) : (
                        <Play size={16} weight="fill" />
                      )}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Restart replay"
                      disabled={!selected}
                      onClick={() => {
                        setPlaying(false);
                        setTime(0);
                      }}
                    >
                      <Repeat size={16} />
                    </button>
                    <span className="tabular-nums text-xs font-medium">
                      {clock(selected ? Math.min(time, end) : 0)}{" "}
                      <span className="font-normal text-stone-400">
                        / {clock(end)}
                      </span>
                    </span>
                  </div>
                  <label className="flex items-center gap-2 text-[10px] text-stone-500">
                    Replay speed
                    <select
                      aria-label="Replay speed"
                      className="rounded border border-[#dce2d6] bg-white px-2 py-1 text-xs"
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      {[1, 4, 8, 16, 32].map((n) => (
                        <option key={n} value={n}>
                          {n}×
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 border-t border-[#e2e7dd] bg-[#f5f7f1] sm:grid-cols-4">
                {[
                  ["Inside now", row?.active],
                  ["Waiting outside", row?.waiting_outside],
                  ["Completed now", row?.completed],
                  ["Not yet arrived", row?.future],
                ].map(([label, value]) => (
                  <div
                    className="border-r border-[#e2e7dd] px-4 py-3 last:border-r-0"
                    key={label}
                  >
                    <p className="text-[10px] text-stone-500">{label}</p>
                    <p className="mt-1 text-xl font-medium tabular-nums">
                      {fmt(value as number | undefined, 0)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!selected}
                  className="secondary"
                  onClick={() => {
                    setReference(selected);
                    setNotice(
                      "Reference pinned. Change an input or load another plan to compare.",
                    );
                  }}
                >
                  <Plus size={14} />
                  Pin reference
                </button>
                <button
                  disabled={!selected}
                  className="secondary"
                  onClick={() => {
                    setReference(selected);
                    update({
                      ...structuredClone(selected!.replay.request),
                      variant:
                        selected!.replay.request.variant === "baseline"
                          ? "second_exit"
                          : "baseline",
                    });
                    setNotice(
                      "Reference pinned; cloned inputs are ready to edit.",
                    );
                  }}
                >
                  <ArrowsSplit size={14} />
                  Clone scenario
                </button>
                <button
                  disabled={!selected || !reference}
                  aria-pressed={compare}
                  className="secondary"
                  onClick={() => setCompare((x) => !x)}
                >
                  Compare maps
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={!selected}
                  className="secondary"
                  onClick={() =>
                    selected &&
                    download(
                      `pathway-${selected.replay.manifest.scenario_sha256.slice(0, 10)}-report.html`,
                      reportHtml(selected, reference, evidence),
                      "text/html",
                    )
                  }
                >
                  <DownloadSimple size={14} />
                  Report
                </button>
                <button
                  disabled={!selected}
                  className="icon-button"
                  aria-label="Download replay JSON"
                  onClick={() =>
                    selected &&
                    download(
                      `pathway-${selected.replay.manifest.scenario_sha256.slice(0, 10)}-replay.json`,
                      JSON.stringify(selected.envelope),
                    )
                  }
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            </div>
            {selected && (
              <section
                className="rounded-xl border border-[#dce2d6] bg-[#fbfcf9] p-5"
                aria-label="Run results"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-semibold">
                      Understand Your Simulation
                    </h2>
                    <p className="mt-1 text-[10px] text-stone-500">
                      Whole-run metrics · one seed · not a safety score
                    </p>
                  </div>
                  {reference && (
                    <button
                      className="text-[10px] underline underline-offset-4"
                      onClick={() => {
                        setReference(null);
                        setCompare(false);
                      }}
                    >
                      Clear reference
                    </button>
                  )}
                </div>
                {partial && (
                  <p className="mb-4 rounded-md bg-[#faf3e3] p-3 text-xs text-[#866329]">
                    {selected.replay.manifest.status === "horizon_reached"
                      ? "Horizon reached with unfinished visitors."
                      : "Partial or failed execution."}{" "}
                    Observed journeys stop at the last recorded time; unfinished
                    visitors remain censored.
                  </p>
                )}
                {reference && (
                  <p
                    className={`mb-4 text-[11px] ${reason ? "text-amber-800" : "text-[#627b54]"}`}
                  >
                    {reason ??
                      `Matched visitors · selected minus pinned ${labels[reference.replay.request.variant].toLowerCase()}. Negative deltas indicate a lower value, not a safety rating.`}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
                  {[
                    ["Completed journeys", "completed_count", "people"],
                    ["Peak outside waiting", "peak_outside_count", "people"],
                    ["Mean outside wait", "mean_outside_wait_s", "s"],
                    [
                      "Formal queue wait (all visitors)",
                      "total_formal_queue_wait_s",
                      "person-s",
                    ],
                    ["Observed mean journey", "restricted_mean_journey_s", "s"],
                    ["Peak inside", "peak_active_count", "people"],
                    ["Unfinished", "unfinished_count", "people"],
                    ["All-person clearance", "clearance_s", "s"],
                  ].map(([label, metric, unit]) => (
                    <div key={metric}>
                      <p className="text-[10px] text-stone-500">{label}</p>
                      <p className="mt-2 text-[23px] font-medium tabular-nums tracking-tight">
                        {fmt(selected.replay.summary.metrics[metric])}
                        <span className="ml-1.5 text-[10px] font-normal text-stone-500">
                          {unit}
                        </span>
                      </p>
                      {reference && !reason && (
                        <p className="mt-1 text-[10px] text-stone-500">
                          Δ{" "}
                          {fmt(
                            delta(
                              reference.replay.summary,
                              selected.replay.summary,
                              metric,
                            ),
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs">
                  {selected.replay.summary.all_arrivals_observed
                    ? "All scheduled arrivals observed."
                    : "Not all scheduled arrivals observed."}{" "}
                  Run status:{" "}
                  {selected.replay.manifest.status.replaceAll("_", " ")}. Total
                  simulated demand: {selected.replay.request.count}.
                </p>
                <p className="mt-2 text-xs">
                  Highest observed zone density:{" "}
                  {(() => {
                    const peak = Object.entries(
                      selected.replay.summary.zones,
                    ).sort(
                      (a, b) =>
                        b[1].peak_density_per_m2 - a[1].peak_density_per_m2,
                    )[0];
                    return peak
                      ? `${zoneName(peak[0])} · ${fmt(peak[1].peak_density_per_m2, 3)} people/m²`
                      : "Unavailable";
                  })()}
                  .
                </p>
                <details className="mt-4 text-xs">
                  <summary>What do these measurements mean?</summary>
                  <p>
                    Density is simulated people in a monitored region divided by
                    its usable area. Sampled person-seconds integrate presence
                    over time; zones overlap and must not be summed. Journey
                    time includes outside waiting; unfinished journeys are
                    censored at the observation end. Formal queue waiting is
                    time observed in modelled service queues, separate from
                    outside waiting. Values depend on assumed movement and
                    service.
                  </p>
                </details>
                <details className="mt-5 border-t border-[#e2e7dd] pt-4">
                  <summary className="cursor-pointer text-[11px] font-medium">
                    Zone measurements & local tradeoffs
                  </summary>
                  <p className="my-3 text-[10px] leading-relaxed text-stone-500">
                    Sampled at 1 s. Zones overlap; do not sum person-seconds. *
                    marks changed usable area. Added gate area changes density
                    denominators. Higher exposure is not an injury estimate.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[10px]">
                      <thead>
                        <tr className="border-b border-[#dce2d6] text-stone-500">
                          <th className="py-2 font-normal">Zone</th>
                          <th className="p-2 font-normal">Area m²</th>
                          <th className="p-2 font-normal">Peak / m²</th>
                          <th className="p-2 font-normal">Person-s</th>
                          {reference && (
                            <th className="p-2 font-normal">Δ person-s</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(selected.replay.summary.zones).map(
                          ([id, z]) => {
                            const ref = reference?.replay.summary.zones[id],
                              d =
                                ref && !reason
                                  ? z.sampled_person_s - ref.sampled_person_s
                                  : null;
                            return (
                              <tr
                                className="border-b border-[#edf0e9]"
                                key={id}
                              >
                                <th className="whitespace-nowrap py-2.5 font-medium">
                                  {zoneName(id)}
                                </th>
                                <td className="p-2 tabular-nums">
                                  {fmt(z.area_m2)}
                                  {ref &&
                                  Math.abs(ref.area_m2 - z.area_m2) > 1e-8
                                    ? " *"
                                    : ""}
                                </td>
                                <td className="p-2 tabular-nums">
                                  {fmt(z.peak_density_per_m2, 3)}
                                </td>
                                <td className="p-2 tabular-nums">
                                  {fmt(z.sampled_person_s)}
                                </td>
                                {reference && (
                                  <td
                                    className={`p-2 tabular-nums ${d != null && d > 0 ? "text-[#9a702c]" : ""}`}
                                  >
                                    {fmt(d)}
                                  </td>
                                )}
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
                <details className="mt-4 border-t border-[#e2e7dd] pt-4">
                  <summary className="cursor-pointer text-[11px] font-medium">
                    Run identity & assumptions
                  </summary>
                  <dl className="mt-3 space-y-2 text-[10px] text-stone-500">
                    <dt>Scenario SHA256</dt>
                    <dd className="break-all font-mono">
                      {selected.replay.manifest.scenario_sha256}
                    </dd>
                    <dt>Demand SHA256</dt>
                    <dd className="break-all font-mono">
                      {selected.replay.manifest.demand_sha256}
                    </dd>
                    <dt>Replay SHA256</dt>
                    <dd className="break-all font-mono">
                      {selected.envelope.sha256}
                    </dd>
                  </dl>
                  <p className="my-3 text-[10px] leading-relaxed text-stone-500">
                    Three queues; fixed assigned routes. Additional exit
                    includes route assignment. Staggering changes arrival times.
                    Off-site costs and imperfect compliance are not modelled.
                    Medical strip is a geometric reservation, not vehicle
                    clearance certification.
                  </p>
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        `pathway-${selected.replay.manifest.scenario_sha256.slice(0, 10)}-scenario.json`,
                        JSON.stringify(selected.replay.scenario, null, 2),
                      )
                    }
                  >
                    Download scenario JSON
                  </button>
                </details>
              </section>
            )}
            <section className="border-t border-[#dce2d6] pt-4">
              <div className="flex items-center justify-between">
                <h2 className="eyebrow">RECENT RESULTS</h2>
                <button
                  className="text-[10px] underline underline-offset-4"
                  onClick={() => fileInput.current?.click()}
                >
                  Open replay file
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-label="Open replay file"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 20_000_000)
                        throw Error("Replay file exceeds 20 MB.");
                      const value = await decodeEnvelope(
                        JSON.parse(await file.text()),
                      );
                      remember(value);
                      select(value);
                    } catch (err) {
                      setError(String(err));
                    }
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {history.map((value) => (
                  <button
                    className={`history-button ${value.envelope.sha256 === selected?.envelope.sha256 ? "history-active" : ""}`}
                    key={value.envelope.sha256}
                    onClick={() => select(value)}
                  >
                    <Check size={12} />
                    <span>
                      {labels[value.replay.request.variant]} ·{" "}
                      {value.replay.request.count}
                    </span>
                    <span className="text-[9px] opacity-60">
                      {value.origin === "file" ? "imported" : value.replay.mode}
                    </span>
                  </button>
                ))}
                {!history.length && (
                  <p className="text-xs text-stone-500">
                    Load a saved example or run a scenario to begin.
                  </p>
                )}
              </div>
              {jobs.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[11px] text-stone-500">
                    Local run history ({jobs.length})
                  </summary>
                  <ul className="mt-2 divide-y divide-[#dce2d6]">
                    {jobs.map((j) => (
                      <li
                        key={j.id}
                        data-job-id={j.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-[11px]"
                      >
                        <div>
                          <p>
                            {labels[j.request.variant]} · {j.request.count}{" "}
                            visitors · {j.status.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-[10px] text-stone-500">
                            {j.message}
                          </p>
                        </div>
                        {j.result_available && (
                          <button
                            className="secondary"
                            onClick={() => void loadJob(j)}
                          >
                            Open result
                          </button>
                        )}
                        {!TERMINAL.includes(j.status) && (
                          <button
                            className="secondary"
                            onClick={() =>
                              void api(`jobs/${j.id}/cancel`, {}).catch((e) =>
                                setError(String(e)),
                              )
                            }
                          >
                            Cancel run
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          </section>
        </div>
        <CrowdPatterns
          selected={selected}
          reference={reference}
          time={time}
          onTime={(next) => {
            setPlaying(false);
            setTime(next);
          }}
        />
        <DecisionSummary selected={selected} reference={reference} />
        <AccessibilityAudit
          audit={audit}
          onChange={setAudit}
          context={evidence.context}
          eventName={event.name}
        />
        <ReportPanel
          selected={selected}
          reference={reference}
          evidence={evidence}
          onDownload={exportReport}
        />
        <footer
          id="method"
          className="mt-8 flex flex-col justify-between gap-3 border-t border-[#dce2d6] py-5 text-[10px] leading-relaxed text-stone-500 sm:flex-row"
        >
          <p className="max-w-[650px]">
            Pathway uses JuPedSim 1.4.2 for pedestrian movement. Inputs are
            assumptions, not a surveyed event. Crowded results are numerically
            sensitive. No field calibration, injury prediction or operational
            approval.
          </p>
          <div className="shrink-0">
            <p>Metres. Seconds. Explicit assumptions.</p>
            <a
              href="https://github.com/13thAline/pathway"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Source & setup instructions
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
