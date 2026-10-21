import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const screenshot = "/tmp/pathway-phase3-browser";
test("saved replay, edits, comparison and immutable export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: `${screenshot}/desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause replay", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.getByRole("slider", { name: "Replay time" }).fill("200");
  await expect(
    page.getByRole("img", { name: "Venue replay at 03:20" }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "Replay time" }).fill("181");
  await expect(
    page.getByRole("img", { name: "Venue replay at 03:00" }),
  ).toBeVisible();
  await expect(
    page.getByText("Inside now", { exact: true }).locator(".."),
  ).toContainText("223");
  await page.getByRole("slider", { name: "Replay time" }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("img", { name: "Venue replay at 10:49" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pin reference", exact: true })
    .click();
  await page.getByRole("radio", { name: "Additional exit" }).check();
  await expect(
    page.getByText("Inputs changed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("slider", { name: "Replay time" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Load saved additional exit", exact: true })
    .click();
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await expect(
    page.getByText("Matched visitors", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare maps", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Reference venue replay" }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshot}/comparison.png`,
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Report", exact: true }).click();
  const report = await downloadPromise,
    content = await readFile((await report.path())!, "utf8");
  expect(content).toContain("Scenario <code>");
  expect(content).toContain("Comparison · selected minus reference");
  expect(content).toContain("Additional exit"); // request variant is snake case; see report context
  expect(errors).toEqual([]);
});
test("fresh job through the UI and cancelled job states", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Local engine connected")).toBeVisible();
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await page.getByLabel("Total visitors").fill("12");
  await page
    .getByRole("button", { name: "Run local simulation", exact: true })
    .click();
  await expect(page.getByText("Fresh local run · succeeded")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("region", { name: "Run results" })).toBeVisible();
  await page
    .getByRole("button", { name: "Clone scenario", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Total visitors").fill("750");
  const jobResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run local simulation", exact: true })
    .click();
  const cancelledJob = await (await jobResponse).json();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByText("Local run history (", { exact: false }).click();
  await expect(
    page.locator(`[data-job-id="${cancelledJob.id}"]`),
  ).toContainText("cancelled", { timeout: 20000 });
  await page.screenshot({
    path: `${screenshot}/cancelled.png`,
    fullPage: true,
  });
});
test("offline API, malformed replay and narrow-screen layout", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await expect(page.getByText("Saved replay mode")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run local simulation", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: `${screenshot}/mobile.png`, fullPage: true });
  await page.getByLabel("Open replay file", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"data":"bad","sha256":"wrong"}'),
  });
  await expect(page.getByRole("alert")).toContainText("not a supported");
  await page.getByLabel("Total visitors").fill("751");
  await expect(
    page.getByRole("alert").filter({ hasText: "Visitors must be" }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeDisabled();
});
test("a result arriving after edits does not replace the new draft", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await page.getByLabel("Total visitors").fill("18");
  await page
    .getByRole("button", { name: "Run local simulation", exact: true })
    .click();
  await page.getByLabel("Total visitors").fill("19");
  await expect(
    page.getByText("A local run finished.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("Total visitors")).toHaveValue("19");
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeDisabled();
});
test("horizon-limited fresh results remain explicit and exportable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await page.getByLabel("Total visitors").fill("30");
  await page.getByText("Timing & movement", { exact: true }).click();
  await page.getByLabel("Peak ends").fill("10");
  await page.getByLabel("Last arrival").fill("30");
  await page.getByLabel("Simulation horizon").fill("30");
  await page
    .getByRole("button", { name: "Run local simulation", exact: true })
    .click();
  await expect(page.getByText("Fresh local run · horizon reached")).toBeVisible(
    { timeout: 30000 },
  );
  await expect(
    page.getByText("Horizon reached with unfinished visitors.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "/tmp/pathway-phase3-browser/partial.png",
    fullPage: true,
  });
});
test("default 500-person fresh run produces a verified downloadable replay", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await page
    .getByRole("button", { name: "Run local simulation", exact: true })
    .click();
  await expect(page.getByText("Fresh local run · succeeded")).toBeVisible({
    timeout: 55000,
  });
  await page.getByRole("slider", { name: "Replay time" }).fill("180");
  await page.screenshot({
    path: "/tmp/pathway-phase3-browser/fresh-500.png",
    fullPage: true,
  });
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download replay JSON", exact: true })
    .click();
  const download = await promise;
  const envelope = JSON.parse(await readFile((await download.path())!, "utf8")),
    payload = JSON.parse(envelope.data);
  expect(payload.mode).toBe("fresh");
  expect(payload.request.count).toBe(500);
  expect(payload.summary.metrics.completed_count).toBe(500);
  expect(
    payload.summary.population.future +
      payload.summary.population.waiting_outside +
      payload.summary.population.active +
      payload.summary.population.completed,
  ).toBe(500);
  await download.saveAs("/tmp/pathway-phase3-browser/fresh-500-replay.json");
  expect(consoleErrors).toEqual([]);
});

test("reopened replay files are labelled imported, never freshly computed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  const request = await page.request.get("/demos/baseline.json");
  const json = await request.body();
  await page.getByLabel("Open replay file", { exact: true }).setInputFiles({
    name: "recorded-run.json",
    mimeType: "application/json",
    buffer: json,
  });
  await expect(page.getByText("Imported replay · succeeded")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report", exact: true }),
  ).toBeEnabled();
});
