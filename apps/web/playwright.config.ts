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
    {
      // Touch device (venue-map-routes task 5.15): the venue map gates
      // one-finger drag on `Browser.touchNative` and relies on
      // `touch-action: pan-x pan-y` for page-scroll pass-through, which only
      // exists on a real touch/pointer-coarse device context. A Desktop
      // Chrome project has no touch, so the 5.6/5.11 touch assertions
      // require this project.
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
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
