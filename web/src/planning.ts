import type { Request } from "./types";
export type EventInfo = {
  name: string;
  type: string;
  arrivalSource: "Synthetic demonstration" | "Organizer estimate";
};
export const initialEvent: EventInfo = {
  name: "",
  type: "Community Puja",
  arrivalSource: "Synthetic demonstration",
};
/** Only venue/event context invalidates inspection, not seed or visitor physics. */
export function inspectionContext(event: EventInfo, request: Request): string {
  return JSON.stringify([
    event.name,
    event.type,
    "synthetic-puja-60x40-v1",
    request.variant,
    request.settings.main_gate_width_m,
    request.settings.second_gate_width_m,
  ]);
}
