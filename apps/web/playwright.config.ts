import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
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
    {
      // Media-tiering tasks 7.5/7.10 (archive gate): the video's exit
      // detection reads `intersectionRatio` against a threshold list —
      // semantics that diverge between engines — and the warm-cache verdict
      // leans on the 304 `transferSize` shape, which is Chromium-measured but
      // WebKit-reported-only. Run the tiering suite on WebKit; the rest of
      // the suite synthesizes touch through CDP and stays Chromium-only.
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: /^(?!.*media-tiering)/,
    },
  ],
});
