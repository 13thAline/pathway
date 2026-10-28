import { defineConfig } from "@playwright/test";
const runDirectory = `../runs/e2e/${Date.now()}-${process.pid}`;
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8766",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox"],
    },
    viewport: { width: 1440, height: 1050 },
  },
  webServer: {
    command: `../.venv/bin/python -m pathway.server --port 8766 --runs ${runDirectory} --static dist`,
    url: "http://127.0.0.1:8766/api/bootstrap",
    reuseExistingServer: false,
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
