import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 10000 });
test("organizer completes the saved 500-person planning and inspection report journey", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Pathway — Intelligent Event Flow and Accessibility Planning",
    }),
  ).toBeVisible();
  await expect(page.getByText("Saved replay · succeeded")).toBeVisible();
  await expect(page.getByLabel("Total visitors")).toHaveValue("500");
  await page
    .getByLabel("Event name (optional)")
    .fill("Synthetic community Puja");
  await page.getByLabel("Arrival source").selectOption("Organizer estimate");
  await expect(
    page.getByRole("img", { name: /350 visitors in the first 3 minutes/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Understand Your Simulation" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pin reference", exact: true })
    .click();
  await page.getByRole("radio", { name: "Additional exit" }).check();
  await page
    .getByRole("button", { name: "Load saved additional exit", exact: true })
    .click();
  await expect(
    page.getByText(
      "The additional-exit intervention changes both gate access and pedestrian route assignments.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare maps", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Reference venue replay" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start new / reset inspection" })
    .click();
  await page
    .getByLabel("Route or location inspected")
    .fill("Internal route, near turn");
  await page
    .getByLabel("Dedicated internal accessible aisle (m)", { exact: true })
    .fill("1.2");
  const finding = page
    .locator(".inspection-findings article")
    .filter({ hasText: "Dedicated internal accessible aisle" });
  await expect(finding).toContainText("Requires review");
  await expect(finding).toContainText("1.5 m");
  await page
    .getByLabel("Continuous step-free route", { exact: true })
    .selectOption("no");
  await page
    .getByLabel("Inspection notes (optional)")
    .fill("<script>site-note</script>");
  const auditDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export inspection JSON" }).click();
  const auditFile = await auditDownload;
  const audit = JSON.parse(await readFile((await auditFile.path())!, "utf8"));
  expect(audit.measurements.aisle).toBe(1.2);
  expect(audit.observations.stepFree).toBe("no");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download planning report" }).click();
  const file = await download;
  const html = await readFile((await file.path())!, "utf8");
  expect(html).toContain("Synthetic community Puja");
  expect(html).toContain("500 expected visitors");
  expect(html).toContain("Plan: Additional exit");
  expect(html).toContain("1.2 m");
  expect(html).toContain("Requires review");
  expect(html).toContain("&lt;script&gt;site-note&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  const envelope = await (
    await page.request.get("/demos/second_exit.json")
  ).json();
  const recorded = JSON.parse(envelope.data);
  expect(html).toContain(recorded.manifest.scenario_sha256);
  expect(html).toContain("Comparison · selected minus reference");
  expect(html).toContain("Saved demonstration");
  expect(html).toContain("Results do not certify safety");
  await file.saveAs("/tmp/pathway-demo-report.html");
  await page.screenshot({
    path: "/tmp/pathway-planning-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Event name (optional)").fill("Different event");
  await expect(
    page.getByText("Event or layout context changed.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start new / reset inspection" })
    .click();
  await page
    .getByLabel("Import inspection JSON", { exact: true })
    .setInputFiles({
      name: "audit.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(audit)),
    });
  await expect(
    page.getByLabel("Dedicated internal accessible aisle (m)", { exact: true }),
  ).toHaveValue("1.2");
  await expect(
    page.getByText("Event or layout context changed.", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("inspection missing values, invalid values and mobile keyboard access remain explicit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const aisle = page.getByLabel("Dedicated internal accessible aisle (m)", {
    exact: true,
  });
  const finding = page
    .locator(".inspection-findings article")
    .filter({ hasText: "Dedicated internal accessible aisle" });
  await expect(finding).toContainText("Not inspected");
  await aisle.fill("-1");
  await expect(finding).toContainText("Insufficient information");
  await expect(
    page.getByRole("button", { name: "Export inspection JSON" }),
  ).toBeDisabled();
  await aisle.fill("1.5");
  await expect(finding).toContainText("Meets this specific measurement check");
  await aisle.fill("");
  await expect(finding).toContainText("Not inspected");
  await page.getByLabel("Clear directional signage", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByLabel("Clear directional signage", { exact: true }),
  ).toHaveValue("yes");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/pathway-planning-mobile.png",
    fullPage: true,
  });
});
