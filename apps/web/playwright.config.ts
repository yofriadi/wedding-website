import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `astro dev` loads apps/web/.env itself, but guarantee DATABASE_URL even on
    // machines without a local .env (CI, fresh clones): point at a scratch DB.
    command: "DATABASE_URL=${DATABASE_URL:-file:./.playwright/db.sqlite} pnpm dev:bare",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
