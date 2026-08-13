import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR,
  webServer: {
    command: "npm run dev -- -H 127.0.0.1 -p 4317",
    env: {
      ...process.env,
      ADMIN_PASSWORD: "e2e-admin-password",
      ADMIN_SESSION_SECRET: "e2e-session-secret-with-more-than-32-characters",
      ZOOMINFO_PROVIDER: "mock",
    },
    url: "http://127.0.0.1:4317",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4317",
    channel: "msedge",
    trace: "retain-on-failure",
  },
});
