import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { defaults } from "./types";
import {
  comparisonReason,
  decodeEnvelope,
  delta,
  frameAt,
  reportHtml,
  requestKey,
  validateRequest,
} from "./model";
const envelope = JSON.parse(
  readFileSync(
    new URL("../public/demos/baseline.json", import.meta.url),
    "utf8",
  ),
);
describe("replay contracts", () => {
  it("verifies a real saved export and population", async () => {
    const { replay } = await decodeEnvelope(envelope);
    expect(replay.request.count).toBe(500);
    expect(replay.ledger.at(-1)?.completed).toBe(500);
    expect(replay.manifest.scenario_sha256).toHaveLength(64);
  });
  it("rejects changed replay bytes", async () => {
    await expect(
      decodeEnvelope({ ...envelope, data: envelope.data + " " }),
    ).rejects.toThrow("integrity");
  });
  it("holds real frames without extrapolating missing people", () => {
    const a = { t: 0, people: [] },
      b = { t: 2, people: [] },
      c = { t: 3.5, people: [] };
    expect(frameAt([a, b, c], 1)).toBe(a);
    expect(frameAt([a, b, c], 100)).toBe(c);
  });
  it("invalidates identity for every input field", () => {
    const original = requestKey(defaults);
    expect(requestKey({ ...defaults, variant: "second_exit" })).not.toBe(
      original,
    );
    expect(requestKey({ ...defaults, seed: 1 })).not.toBe(original);
    expect(
      requestKey({
        ...defaults,
        settings: { ...defaults.settings, service_s: [1, 2] },
      }),
    ).not.toBe(original);
  });
  it("rejects impossible and incomplete inputs", () => {
    expect(validateRequest({ ...defaults, count: 751 })).not.toHaveLength(0);
    expect(
      validateRequest({
        ...defaults,
        settings: { ...defaults.settings, main_gate_width_m: 0 },
      }),
    ).not.toHaveLength(0);
    expect(validateRequest({ ...defaults, count: NaN })).not.toHaveLength(0);
  });
  it("refuses unmatched and failed comparisons and censored tail deltas", async () => {
    const { replay: r } = await decodeEnvelope(envelope);
    const a = r.summary;
    expect(
      comparisonReason(a, { ...a, identity_sha256: "different" }),
    ).toContain("not matched");
    expect(
      delta(a, { ...a, usable_for_comparison: false }, "clearance_s"),
    ).toBeNull();
    const b = { ...a, metrics: { ...a.metrics, unfinished_count: 5 } };
    expect(delta(a, b, "completed_journey_p95_s")).toBeNull();
  });
  it("exports hashes and literal content with safe HTML encoding", async () => {
    const loaded = await decodeEnvelope(envelope);
    const html = reportHtml(loaded, null);
    expect(html).toContain(loaded.replay.manifest.scenario_sha256);
    loaded.replay.limitations = ["<script>attack</script>"];
    expect(reportHtml(loaded, null)).not.toContain("<script>");
  });
});
it("rejects internally inconsistent and oversized replays even with a valid digest", async () => {
  const payload = JSON.parse(envelope.data);
  payload.ledger.at(-1).completed = 499;
  const data = JSON.stringify(payload),
    sha256 = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  await expect(decodeEnvelope({ data, sha256 })).rejects.toThrow("population");
  const bad = JSON.parse(envelope.data);
  bad.scenario.geometry.boundary = Array(2001).fill([0, 0]);
  const data2 = JSON.stringify(bad),
    hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data2)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  await expect(decodeEnvelope({ data: data2, sha256: hash })).rejects.toThrow(
    "geometry",
  );
});
