import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 10000 });
test("crowd patterns synchronize recorded maps, charts, comparison and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  const panel = page.getByRole("region", {
    name: "Crowd Patterns",
    exact: true,
  });
  await expect(
    panel.getByRole("img", { name: "Density by zone and time" }),
  ).toBeVisible();
  const envelope = await (
    await page.request.get("/demos/baseline.json")
  ).json();
  const data = JSON.parse(envelope.data);
  const map = panel.getByRole("img", { name: /^Crowding map:/ });
  const mapBox = (await map.boundingBox())!;
  const mapScale = Math.min(
    (mapBox.width - 64) / 64,
    (mapBox.height - 54) / 44,
  );
  await map.click({
    position: {
      x: (mapBox.width - 60 * mapScale) / 2 + 24 * mapScale,
      y: (mapBox.height - 40 * mapScale) / 2 + 3 * mapScale,
    },
  });
  await expect(panel.getByLabel("Monitored zone", { exact: true })).toHaveValue(
    "medical_access",
  );
  await panel
    .getByLabel("Monitored zone", { exact: true })
    .selectOption("departure_merge");
  await panel
    .getByRole("slider", { name: "Crowd observation time" })
    .fill("181");
  const row = data.zone_samples.find(
    (s: any) => s.id === "departure_merge" && s.t === 181,
  );
  await expect(panel.locator(".observation-status")).toContainText(
    "analytical sample 181 s",
  );
  await expect(panel.locator(".observation-status")).toContainText(
    "held pedestrian frame 180 s",
  );
  await expect(panel.locator(".observation-status")).toContainText(
    `count ${row.count}`,
  );
  await expect(
    page.getByRole("img", { name: "Venue replay at 03:00", exact: true }),
  ).toBeVisible();
  await panel.getByRole("slider", { name: "Crowd observation time" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    panel.getByRole("slider", { name: "Crowd observation time" }),
  ).not.toHaveValue("181");
  const chart = panel.getByRole("img", {
    name: "Departure Merge — density",
    exact: true,
  });
  const box = (await chart.boundingBox())!;
  await chart.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const cursor = Number(
    await panel
      .getByRole("slider", { name: "Crowd observation time" })
      .inputValue(),
  );
  expect(cursor).toBeGreaterThan(200);
  expect(cursor).toBeLessThan(400);
  await panel
    .getByLabel("Crowding map measurement", { exact: true })
    .selectOption("sampled_person_s");
  await expect(
    panel.getByText("Whole-run summary:", { exact: false }),
  ).toBeVisible();
  const cell = panel.locator('rect[data-zone="holding"]').nth(10);
  const cellTime = Number(await cell.getAttribute("data-time"));
  await cell.click();
  await expect(panel.getByLabel("Monitored zone", { exact: true })).toHaveValue(
    "holding",
  );
  await expect(
    panel.getByRole("slider", { name: "Crowd observation time" }),
  ).toHaveValue(String(cellTime));
  await page
    .getByRole("button", { name: "Pin reference", exact: true })
    .click();
  await page.getByRole("radio", { name: "Additional exit" }).check();
  await expect(
    panel.getByText("No matching result selected.", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByRole("img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load saved additional exit", exact: true })
    .click();
  await expect(
    panel.getByRole("img", { name: "Pinned crowding map", exact: true }),
  ).toBeVisible();
  const increase = panel.getByRole("button", {
    name: /Largest recorded exposure increase:/,
  });
  await increase.click();
  await expect(
    panel.getByLabel("Crowding map measurement", { exact: true }),
  ).toHaveValue("sampled_person_s");
  await panel
    .getByLabel("Compare zone measurement", { exact: true })
    .selectOption("peak_density_per_m2");
  await expect(
    panel.getByRole("img", { name: "Peak sampled density", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("Usable area changed;", { exact: false }),
  ).toBeVisible();
  const csvPromise = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download crowd measurements CSV" })
    .click();
  const csv = await readFile((await (await csvPromise).path())!, "utf8");
  const selectedData = JSON.parse(
    (await (await page.request.get("/demos/second_exit.json")).json()).data,
  );
  expect(csv).toContain(selectedData.manifest.scenario_sha256);
  expect(csv.split("\r\n")).toHaveLength(selectedData.zone_samples.length + 1);
  const reportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download planning report" }).click();
  const report = await reportPromise;
  const html = await readFile((await report.path())!, "utf8");
  expect(html).toContain("Crowd Patterns — recorded visual evidence");
  expect(html).toContain("<svg");
  expect(html).toContain("data:text/csv");
  expect(html).toContain(selectedData.manifest.scenario_sha256);
  await report.saveAs("/tmp/sahajyatra-crowd-report.html");
  await panel.screenshot({ path: "/tmp/sahajyatra-crowd-patterns.png" });
  expect(errors).toEqual([]);
});

test("missing samples stay unavailable and incompatible charts are rejected on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await page
    .getByRole("button", { name: "Pin reference", exact: true })
    .click();
  const envelope = await (
    await page.request.get("/demos/baseline.json")
  ).json();
  const data = JSON.parse(envelope.data);
  data.zone_samples = data.zone_samples.filter(
    (r: any) => r.id !== "service_queue" || r.t < 10 || r.t > 30,
  );
  data.summary.identity_sha256 = "f".repeat(64);
  const payload = JSON.stringify(data);
  const sha256 = await page.evaluate(
    async (payload) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(payload),
          ),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
    payload,
  );
  await page.getByLabel("Open replay file", { exact: true }).setInputFiles({
    name: "gapped.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ sha256, data: payload })),
  });
  await expect(page.getByText("Imported replay · succeeded")).toBeVisible();
  const panel = page.getByRole("region", {
    name: "Crowd Patterns",
    exact: true,
  });
  await panel
    .getByRole("slider", { name: "Crowd observation time" })
    .fill("20");
  await expect(panel.locator(".observation-status")).toContainText(
    "analytical sample unavailable",
  );
  await expect(panel.locator(".observation-status")).toContainText(
    "Density Unavailable",
  );
  await expect(
    panel.getByRole("region", { name: "Crowd chart comparison" }),
  ).toContainText("Visitors are not matched");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: "/tmp/sahajyatra-crowd-mobile.png" });
});
