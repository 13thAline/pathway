import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8765",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox"],
    },
    viewport: { width: 1440, height: 1050 },
  },
  webServer: {
    command:
      "../.venv/bin/python -m pathway.server --port 8765 --runs ../runs/e2e --static dist",
    url: "http://127.0.0.1:8765/api/bootstrap",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.PATHWAY_BROWSER_REPORT || "../runs/browser-results.json",
      },
    ],
  ],
  outputDir: process.env.PATHWAY_BROWSER_OUTPUT || "../runs/browser-tests",
});
