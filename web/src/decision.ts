import type { Loaded } from "./types";
import { comparisonReason, delta, fmt } from "./model";
export type Decision = {
  findings: string[];
  actions: string[];
  available: boolean;
};
export function explainDecision(
  current: Loaded,
  reference: Loaded | null,
): Decision {
  if (!reference)
    return {
      available: false,
      findings: [
        "Pin a reference and select a compatible alternative to explain measured differences.",
      ],
      actions: ["Confirm that assumed pedestrian routes match the venue."],
    };
  const a = reference.replay.summary,
    b = current.replay.summary;
  const reason = comparisonReason(a, b);
  if (reason)
    return {
      available: false,
      findings: [reason],
      actions: [
        "Obtain compatible observations before drawing a comparative conclusion.",
      ],
    };
  const findings: string[] = [],
    actions: string[] = [
      "Confirm that assumed pedestrian routes match real event conditions.",
    ];
  if (a.metrics.unfinished_count || b.metrics.unfinished_count)
    findings.push(
      "Horizon-limited observations include unfinished visitors; journey times are censored and do not establish eventual clearance.",
    );
  for (const [id, z] of Object.entries(b.zones)) {
    const before = a.zones[id];
    const difference = z.sampled_person_s - before.sampled_person_s;
    if (difference !== 0)
      findings.push(
        `Selected plan ${difference < 0 ? "reduced" : "increased"} measured exposure in ${id.replaceAll("_", " ")} by ${fmt(Math.abs(difference))} person-s relative to the pinned plan.`,
      );
    if (difference > 0)
      actions.push(
        `Review the ${id.replaceAll("_", " ")} zone and its observed exposure.`,
      );
    if (Math.abs(z.area_m2 - before.area_m2) > 1e-8)
      findings.push(
        `${id.replaceAll("_", " ")} has changed usable area; density denominators differ.`,
      );
  }
  const completed = delta(a, b, "completed_count");
  if (completed != null && completed !== 0)
    findings.push(
      `${Math.abs(completed)} ${completed > 0 ? "more" : "fewer"} simulated visitors completed within the observation horizon.`,
    );
  if (current.replay.request.variant !== reference.replay.request.variant) {
    if (
      [current, reference].some(
        (x) => x.replay.request.variant === "second_exit",
      )
    ) {
      findings.push(
        "The additional-exit intervention changes both gate access and pedestrian route assignments.",
      );
      actions.push(
        "Check whether the proposed extra exit and assigned routes are physically feasible.",
      );
    }
    if (
      [current, reference].some((x) => x.replay.request.variant === "staggered")
    ) {
      findings.push(
        "Staggering changes arrival timing; off-site waiting, scheduling costs and adherence are not represented.",
      );
      actions.push(
        "Verify whether arrival staggering is practical for visitors.",
      );
    }
  }
  if (!findings.length)
    findings.push(
      "No differences were observed in the inspected comparison metrics.",
    );
  findings.push(
    "Matched visitor attributes, equal horizons and compatible measurement definitions; this comparison does not select an overall best or safe plan.",
  );
  return { available: true, findings, actions };
}
