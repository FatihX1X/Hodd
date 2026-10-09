import { defineConfig, devices } from "@playwright/test";

// Opt-in live Arc Testnet run against a deployed host. Never part of `pnpm test:e2e`.
export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60_000,
  reporter: "list",
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? "https://app.hoddfinance.xyz",
    headless: false,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
