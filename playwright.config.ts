import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  // The journeys intentionally mutate the app's in-memory workspace through one shared
  // dev server. Running spec files concurrently lets one journey replace another's lists.
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR,
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --webpack -H 127.0.0.1 -p 4317`,
    env: {
      ...process.env,
      ZOOMINFO_PROVIDER: "mock",
      OPENAI_USE_MOCK: "true",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    },
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4317",
    channel: "msedge",
    trace: "retain-on-failure",
  },
});
