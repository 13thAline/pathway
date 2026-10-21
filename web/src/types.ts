export type Variant = "baseline" | "second_exit" | "staggered";
export type Settings = {
  main_gate_width_m: number;
  second_gate_width_m: number;
  arrival_end_s: number;
  peak_end_s: number;
  peak_fraction: number;
  service_s: [number, number];
  speed_m_s: [number, number];
  horizon_s: number;
  dt_s: number;
};
export type Request = {
  variant: Variant;
  count: number;
  seed: number;
  settings: Settings;
};
export const defaults: Request = {
  variant: "baseline",
  count: 500,
  seed: 0,
  settings: {
    main_gate_width_m: 1.2,
    second_gate_width_m: 2.4,
    arrival_end_s: 600,
    peak_end_s: 180,
    peak_fraction: 0.7,
    service_s: [1.5, 3],
    speed_m_s: [1, 1.4],
    horizon_s: 1200,
    dt_s: 0.01,
  },
};
export const labels: Record<Variant, string> = {
  baseline: "Baseline",
  second_exit: "Additional exit",
  staggered: "Staggered arrivals",
};
export type XY = [number, number];
export type Scenario = {
  id: string;
  geometry: { boundary: XY[]; obstacles: XY[][] };
  origins: { id: string; positions: XY[] }[];
  exits: { id: string; polygon: XY[] }[];
  services: { id: string; positions: XY[] }[];
  zones: { id: string; polygon: XY[] }[];
  lines: { id: string; points: XY[] }[];
  provenance: Record<string, string>;
  [key: string]: unknown;
};
export type Ledger = {
  time_s: number;
  total: number;
  future: number;
  waiting_outside: number;
  active: number;
  completed: number;
  rejected: number;
  queued: number;
  serving: number;
  scheduled_by_time: number;
};
export type Frame = { t: number; people: [number, number, number, number][] };
export type ZoneSummary = {
  area_m2: number;
  peak_count: number;
  peak_density_per_m2: number;
  sampled_person_s: number;
  sampled_occupied_s: number;
  sampled_slow_s: number;
};
export type Summary = {
  status: string;
  usable_for_comparison: boolean;
  identity_sha256: string;
  demand_sha256: string;
  horizon_s: number;
  simulated_time_s: number;
  all_arrivals_observed: boolean;
  population: Ledger;
  metrics: Record<string, number | null>;
  zones: Record<string, ZoneSummary>;
  measurement: {
    sample_interval_s: number;
    slow_speed_m_s: number;
    [key: string]: unknown;
  };
  reserved_strip_connected_for_model_radius: boolean;
  wall_time_s: number;
  [key: string]: unknown;
};
export type Replay = {
  format: "pathway-replay-1";
  mode: "saved" | "fresh";
  request: Request;
  request_sha256: string;
  scenario: Scenario;
  manifest: {
    status: string;
    scenario_sha256: string;
    demand_sha256: string;
    simulated_time_s: number;
    horizon_s: number;
    error: string | null;
    environment: {
      kernel_source_sha256: string;
      code_revision: string;
      packages: Record<string, string>;
    };
    output_sha256: Record<string, string>;
    [key: string]: unknown;
  };
  summary: Summary;
  display: {
    sample_interval_s: number;
    position_precision_m: number;
    interpolation: string;
  };
  visitor_ids: string[];
  frames: Frame[];
  ledger: Ledger[];
  zone_samples: {
    t: number;
    id: string;
    count: number;
    density: number;
    speed: number | null;
  }[];
  limitations: string[];
};
export type Envelope = { sha256: string; data: string };
export type Loaded = {
  envelope: Envelope;
  replay: Replay;
  origin: "example" | "local" | "file";
};
export type Job = {
  id: string;
  request: Request;
  request_sha256: string;
  status: string;
  result_available: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  message: string;
};
