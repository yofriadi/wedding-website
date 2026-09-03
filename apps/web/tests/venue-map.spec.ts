import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

/**
 * venue-map-routes regression tests (tasks 5.11 / 5.4 / 5.10 / 5.13).
 *
 * The three most regression-prone requirements, pinned by request
 * interception rather than pixel assertions:
 *   (a) nothing map-shaped (Leaflet runtime, its CSS, the geometry chunk, or
 *       tile requests) is fetched before the section nears the viewport —
 *       this is what keeps the "no map resources loaded on initial page
 *       load" scenario honest (design D11);
 *   (b) no request EVER goes to router.project-osrm.org — route geometry is
 *       baked at build time (task 2.2), so a live OSRM call would be a spec
 *       violation (offline-safe, no runtime routing API);
 *   (c) prefers-reduced-motion strips the destination marker's pulse
 *       animation (the static-marker assertion from task 5.10).
 */

/** URL substrings that count as "map resources". */
const MAP_RESOURCE_PATTERNS = [
  "leaflet",
  "venue-map",
  "basemaps.cartocdn.com",
  "router.project-osrm.org",
];

function looksLikeMapResource(url: string): boolean {
  return MAP_RESOURCE_PATTERNS.some((pattern) => url.includes(pattern));
}

test("no map resources are requested before scrolling to the section", async ({ page }) => {
  const mapRequests: string[] = [];
  page.on("request", (request) => {
    if (looksLikeMapResource(request.url())) {
      mapRequests.push(request.url());
    }
  });

  await page.goto("/");
  await dismissWelcomeGate(page);

  // Give any eager loader plenty of time to misbehave before the scroll.
  await page.waitForTimeout(1_500);

  expect(mapRequests, `map resources requested before scroll: ${mapRequests.join(", ")}`).toEqual(
    [],
  );
});

test("no OSRM request is ever made (route geometry is baked)", async ({ page }) => {
  const osrmRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("router.project-osrm.org")) {
      osrmRequests.push(request.url());
    }
  });

  await page.goto("/");
  await dismissWelcomeGate(page);

  // Scroll all the way through the page so the map mounts and renders.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(4_000);

  expect(osrmRequests, `OSRM requests: ${osrmRequests.join(", ")}`).toEqual([]);
});

test("map initializes lazily once the section enters the viewport", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);

  const section = page.locator("#venue-map");
  await section.scrollIntoViewIfNeeded();
  await section.locator(".leaflet-container").waitFor({ state: "attached", timeout: 15_000 });

  // The placeholder must be hidden once Leaflet has taken over. Since the
  // crossfade change the hide is staged (placeholder dims over 250ms, then
  // the `hidden` class lands ~260ms after mount) — toBeHidden retries until
  // then, so give it headroom beyond the default 5s if the machine is slow.
  await expect(section.locator("[data-venue-map-placeholder]")).toBeHidden({
    timeout: 10_000,
  });

  // The static fallback stays hidden while the map works.
  await expect(section.locator("[data-venue-map-fallback]")).toBeHidden();
});

test("leaflet stylesheet is injected at mount, not eager in <head>", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);

  // Before scroll: no Leaflet stylesheet anywhere in the document.
  await expect(page.locator("style[data-venue-map-leaflet]")).toHaveCount(0);
  await expect(page.locator("head link[href*='leaflet']")).toHaveCount(0);

  await page.locator("#venue-map").scrollIntoViewIfNeeded();
  await page
    .locator("style[data-venue-map-leaflet]")
    .waitFor({ state: "attached", timeout: 15_000 });
});

test("destination marker has no pulse animation under prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await dismissWelcomeGate(page);

  await page.locator("#venue-map").scrollIntoViewIfNeeded();
  await page.locator(".leaflet-container").waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1_500);

  // The pulse ring element still renders (it is decorative, not removed), but
  // the reduced-motion media query must keep its animation name empty.
  const animation = await page.evaluate(() => {
    const pulse = document.querySelector(".venue-map-marker-pulse");
    return pulse ? getComputedStyle(pulse).animationName : null;
  });
  expect(animation).toBe("none");
});

test("venue name appears exactly once in the rendered page", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);

  const count = await page.getByText("Graha 58 Gedung Serbaguna UMS", { exact: false }).count();
  // The venue map section owns the single visible venue-name block; the map's
  // destination popup would add a second — but popups are only built on
  // click, so at rest the count must be exactly one.
  expect(count).toBe(1);
});

test("no-JS visitors see the static fallback, not a spinner", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");

  const section = page.locator("#venue-map");

  // The noscript style block reveals the fallback and hides the spinner copy.
  await expect(section.locator("[data-venue-map-fallback]")).toBeVisible();
  await expect(section.locator("[data-venue-map-placeholder]")).toBeHidden(); // noscript: instant, no crossfade

  // The fallback must carry the Google Maps link (the only venue-maps path
  // for no-JS visitors — design D18).
  await expect(
    section.locator("[data-venue-map-fallback] a[href*='google.com/maps']"),
  ).toBeVisible();

  await context.close();
});

test("map geometry ends at the shared venue constants", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator("#venue-map").scrollIntoViewIfNeeded();
  await page.locator("#venue-map .leaflet-container").waitFor({
    state: "attached",
    timeout: 15_000,
  });

  const [{ ROUTE_GEOMETRY }, venue] = await Promise.all([
    import("../src/components/venue-map-routes"),
    import("../src/lib/venue"),
  ]);
  for (const route of Object.values(ROUTE_GEOMETRY)) {
    expect(route.coordinates.at(-1)).toEqual([venue.VENUE_LAT, venue.VENUE_LNG]);
  }
});
