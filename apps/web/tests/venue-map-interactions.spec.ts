import { test, expect, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

/**
 * venue-map-routes interaction tests (tasks 5.1/5.2/5.3/5.6/5.9/5.14/5.16).
 *
 * Drives the real Leaflet map: markers, popups, MapCN-style route planning,
 * automatic color-scheme changes, cluster zoom, desktop dragging, and keyboard
 * accessibility. Tile traffic goes to the real Carto CDN.
 */

async function scrollToMap(page: Page) {
  await page.goto("/");
  await dismissWelcomeGate(page);
  const section = page.locator("#venue-map");
  await section.scrollIntoViewIfNeeded();
  await section.locator(".leaflet-container").waitFor({ state: "attached", timeout: 15_000 });
  await section.locator("img.leaflet-tile").first().waitFor({ state: "visible", timeout: 15_000 });
  await section
    .locator(".venue-map-directions-control")
    .waitFor({ state: "visible", timeout: 15_000 });
  await section.locator(".venue-map-route-planner").waitFor({ state: "visible", timeout: 15_000 });
  await section
    .locator(".venue-map-marker-destination")
    .waitFor({ state: "attached", timeout: 15_000 });
  return section;
}

/** Clicks a marker exactly, bypassing icon overlap in the venue cluster. */
async function clickMarker(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, selector);
}

/** Dismisses the open popup. Popups have no close button, and Leaflet only
 *  arms its own Escape-to-close while the map container itself has focus, so
 *  tests close popups the way visitors do: a map-background click. A synthetic
 *  click dispatched on the container is a clean background click — Leaflet
 *  computes no layer target, so no polyline/marker can be hit. */
async function closePopup(page: Page) {
  await page.evaluate(() => {
    document
      .querySelector("#venue-map .leaflet-container")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Current map zoom, exposed via the container's data attribute. */
async function mapZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#venue-map [data-venue-map-container]");
    return el ? Number(el.dataset.venueMapZoom ?? 0) : 0;
  });
}

test("all seven markers render and popups show the expected content", async ({ page }) => {
  const section = await scrollToMap(page);

  await expect(section.locator(".venue-map-marker")).toHaveCount(7);
  await expect(section.locator(".venue-map-marker-destination")).toHaveCount(1);

  await clickMarker(page, "#venue-map .venue-map-marker-destination");
  // Leaflet fades the closing popup out alongside the new one; the active
  // popup is always the last in DOM order.
  const popup = page.locator(".leaflet-popup").last();
  await expect(popup).toBeVisible();
  // MapCN rich popup: photo banner, category, enlarged venue name.
  await expect(popup.locator(".venue-map-popup-banner img")).toBeVisible();
  await expect(popup.getByText("Gedung Konvensi")).toBeVisible();
  const venueName = popup.getByRole("heading", { name: "Graha 58" });
  await expect(venueName).toBeVisible();
  await expect(venueName).toHaveCSS("font-size", "18px");
  // Rich popups are informational: no Google Maps action inside (and no Leaflet
  // close button), because the top-left directions control is the single exit.
  await expect(popup.locator("a")).toHaveCount(0);

  // Clicking outside the popup (map background) closes it — Leaflet's
  // default closePopupOnClick. Right-middle stays clear of the autoPanned
  // popup and every corner control on both desktop and mobile.
  const mapBox = await section.locator(".leaflet-container").boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.click(mapBox!.x + mapBox!.width - 24, mapBox!.y + mapBox!.height * 0.5);
  await expect(popup).toBeHidden();
  await clickMarker(page, "#venue-map .venue-map-marker:not(.venue-map-marker-destination)");
  await expect(popup.getByText("Terminal")).toBeVisible();
  await expect(popup.getByText("Tirtonadi")).toBeVisible();
  await expect(popup.getByText("3.3 km")).toBeVisible();
  await expect(popup.getByText("14 min")).toBeVisible();
  await expect(popup.locator("a")).toHaveCount(0);

  // POI rich popup: photo banner, Indonesian category, name — again no action.
  await closePopup(page);
  await clickMarker(page, "#venue-map .venue-map-marker[title='Selat Solo Tenda Biru']");
  await expect(popup.locator(".venue-map-popup-banner img")).toBeVisible();
  await expect(popup.getByText("Restoran")).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Selat Solo Tenda Biru" })).toBeVisible();
  await expect(popup.locator("a")).toHaveCount(0);
});

test("cluster click zooms to 17 and route planning selects a route", async ({ page }) => {
  const section = await scrollToMap(page);
  const popup = page.locator(".leaflet-popup");

  await clickMarker(page, "#venue-map .venue-map-marker-destination");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => mapZoom(page)).toBeGreaterThanOrEqual(17);

  // Closing and re-tapping at the target must open immediately even though
  // setView would be a no-op and therefore emit no moveend event.
  await page.waitForTimeout(1_200);
  await closePopup(page);
  await expect(popup).toBeHidden();
  await clickMarker(page, "#venue-map .venue-map-marker-destination");
  await expect(popup).toBeVisible();

  // Selecting a route remains the overview escape, including on touch devices
  // where drag panning is disabled. The taller viewport may still fit a short
  // route at zoom 17, so assert the route-selection contract rather than a
  // brittle numeric zoom threshold.
  await section.getByRole("button", { name: /Purwosari:.*1\.9 km/ }).click();
  await expect(section.getByRole("button", { name: /Purwosari:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(section.locator(".venue-map-route-option[aria-pressed='true']")).toHaveCount(1);
});

test("no route is selected initially; the first selection takes over", async ({ page }) => {
  const section = await scrollToMap(page);
  const control = section.locator(".venue-map-directions-control");
  const routeButtons = section.locator(".venue-map-route-option");

  await expect(routeButtons).toHaveCount(4);
  await expect(routeButtons.nth(0)).toHaveAccessibleName("Terminal Tirtonadi: 14 min, 3.3 km");
  await expect(routeButtons.nth(1)).toHaveAccessibleName("Stasiun Purwosari: 8 min, 1.9 km");
  await expect(routeButtons.nth(2)).toHaveAccessibleName("Stasiun Solo Balapan: 13 min, 3.0 km");
  await expect(routeButtons.nth(3)).toHaveAccessibleName("Bandara Adi Soemarmo: 29 min, 11 km");

  // The route chips form one horizontally scrollable row at the bottom-left;
  // the Google Maps control moved to the top-left corner.
  const planner = section.locator(".venue-map-route-planner");
  await expect(
    section.locator(".leaflet-bottom.leaflet-left .venue-map-route-planner"),
  ).toHaveCount(1);
  await expect(
    section.locator(".leaflet-top.leaflet-left .venue-map-directions-control"),
  ).toHaveCount(1);
  await expect(planner).toHaveCSS("flex-direction", "row");
  await expect(planner).toHaveCSS("overflow-x", "auto");
  const buttonBoxes = await Promise.all([0, 1, 2, 3].map((i) => routeButtons.nth(i).boundingBox()));
  for (const box of buttonBoxes) expect(box).not.toBeNull();
  expect(new Set(buttonBoxes.map((box) => Math.round(box!.y))).size).toBe(1);

  // The row spans the full map width, flush to both edges — no Leaflet
  // control-margin gaps — while the CARDS keep a small inset from the screen
  // edges (padding inside the scroll area). The strip itself ignores pointer
  // events so the empty part passes map/page gestures through; chips stay
  // interactive.
  const plannerBox = await planner.boundingBox();
  const containerBox = await section.locator("[data-venue-map-container]").boundingBox();
  expect(plannerBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(Math.abs(plannerBox!.x - containerBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(plannerBox!.width - containerBox!.width)).toBeLessThanOrEqual(2);
  await expect(planner).toHaveCSS("pointer-events", "none");
  await expect(routeButtons.first()).toHaveCSS("pointer-events", "auto");
  const firstChipBox = await routeButtons.first().boundingBox();
  expect(firstChipBox).not.toBeNull();
  expect(firstChipBox!.x - containerBox!.x).toBeGreaterThanOrEqual(9);

  // Initial state: nothing selected and NO route path is rendered at all.
  // The directions control points at the venue's place page.
  await expect(section.locator(".venue-map-route-option[aria-pressed='true']")).toHaveCount(0);
  await expect(control).toHaveText("Open in Google Maps");
  // Default colorScheme (light): the control is a translucent-white card like
  // the zoom circles + route chips beside it, not a fixed black pill.
  await expect(control).toHaveCSS("background-color", "rgba(255, 255, 255, 0.94)");
  await expect(control).toHaveCSS("color", "rgb(38, 38, 38)");
  await expect(control).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0.1)");
  await expect(control).toHaveAttribute("href", "https://maps.app.goo.gl/VAeWL7EqazFi3Nh66");
  await expect(section.locator("path.leaflet-interactive")).toHaveCount(0);

  await section.getByRole("button", { name: /Adi Soemarmo:/ }).click();
  await expect(section.locator(".venue-map-route-option[aria-pressed='true']")).toHaveCount(1);
  await expect(section.getByRole("button", { name: /Adi Soemarmo:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(control).toHaveText("Open in Google Maps");
  await expect(control).toHaveAttribute(
    "href",
    /origin=-7\.5162608,110\.7560184&destination=-7\.5682749,110\.8053926&travelmode=driving/,
  );

  // After the first selection, ONLY the airport route renders, fully in its
  // own color: road core + glow + the dashed access connector = 3 paths.
  const selectedStyles = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<SVGPathElement>("#venue-map path.leaflet-interactive"),
    ).map((path) => path.getAttribute("stroke")),
  );
  expect(selectedStyles).toHaveLength(3);
  expect(selectedStyles.every((color) => color === "#8b5cf6")).toBe(true);
  await expect(section.locator("path[stroke-dasharray]:not([stroke-dasharray=''])")).toHaveCount(1);

  // A background click may close a popup but must not clear route selection.
  // Right-middle stays clear of the auto-open venue popup.
  const box = await section.locator(".leaflet-container").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width - 24, box!.y + box!.height * 0.5);
  await expect(section.locator(".venue-map-route-option[aria-pressed='true']")).toHaveCount(1);
  await expect(section.getByRole("button", { name: /Adi Soemarmo:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The fourth origin (Stasiun Solo Balapan) selects and drives the
  // directions URL like any other route.
  await section.getByRole("button", { name: /Solo Balapan:/ }).click();
  await expect(section.getByRole("button", { name: /Solo Balapan:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(control).toHaveAttribute(
    "href",
    /origin=-7\.5572285,110\.8209388&destination=-7\.5682749,110\.8053926&travelmode=driving/,
  );

  // Clicking the already-selected chip toggles back to the no-selection
  // state: nothing pressed, directions control back to the venue place page,
  // every route path hidden again, and — per the couple — the view STAYS
  // where it is (no zoom back to the venue's zoom-17 init state).
  await section.getByRole("button", { name: /Solo Balapan:/ }).click();
  await expect(section.locator(".venue-map-route-option[aria-pressed='true']")).toHaveCount(0);
  await expect(control).toHaveAttribute("href", "https://maps.app.goo.gl/VAeWL7EqazFi3Nh66");
  await expect(section.locator("path.leaflet-interactive")).toHaveCount(0);
  // The zoom never returns to the venue's zoom-17 init — it stays on the
  // route-overview the visitor was looking at (any value below 17 proves the
  // toggle did not re-zoom).
  expect(await mapZoom(page)).toBeLessThan(17);

  // A transit-origin MARKER click also toggles its route off.
  await section.getByRole("button", { name: /Purwosari:/ }).click();
  await expect(section.getByRole("button", { name: /Purwosari:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickMarker(page, "#venue-map .venue-map-marker[title='Purwosari']");
  await expect(section.locator(".venue-map-route-option[aria-pressed='true']")).toHaveCount(0);
  await expect(control).toHaveAttribute("href", "https://maps.app.goo.gl/VAeWL7EqazFi3Nh66");
});

test("map follows device theme and renders no manual theme control", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const section = await scrollToMap(page);
  const container = section.locator("[data-venue-map-container]");

  const control = section.locator(".venue-map-directions-control");

  await expect(container).toHaveClass(/theme-light/);
  await expect(section.locator("img.leaflet-tile[src*='light_all']").first()).toBeVisible();
  await expect(section.getByRole("button", { name: /Switch to .* map/ })).toHaveCount(0);
  // The one remaining "Open in Google Maps" surface flips with the theme.
  await expect(control).toHaveCSS("background-color", "rgba(255, 255, 255, 0.94)");
  await expect(control).toHaveCSS("color", "rgb(38, 38, 38)");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(container).toHaveClass(/theme-dark/);
  await expect(section.locator("img.leaflet-tile[src*='dark_all']").first()).toBeVisible();
  await expect(section.locator("img.leaflet-tile[src*='light_all']")).toHaveCount(0);
  await expect(control).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(control).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(control).toHaveCSS("border-top-color", "rgb(255, 255, 255)");
});

test("zoom UI is top-right and provider credits remain without the Leaflet flag", async ({
  page,
}) => {
  const section = await scrollToMap(page);

  const zoom = section.locator(".leaflet-top.leaflet-right .leaflet-control-zoom");
  await expect(zoom).toHaveCount(1);
  const zoomIn = zoom.getByRole("button", { name: "Zoom in" });
  const zoomOut = zoom.getByRole("button", { name: "Zoom out" });
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();

  // Two detached 36px circles with a 6px gap — not Leaflet's default joined
  // bar (no bar background/shadow, no first/last-child corner radii).
  await expect(zoom).toHaveCSS("box-shadow", "none");
  await expect(zoom).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(zoomIn).toHaveCSS("border-radius", "50%");
  await expect(zoomOut).toHaveCSS("border-radius", "50%");
  const inBox = await zoomIn.boundingBox();
  const outBox = await zoomOut.boundingBox();
  expect(inBox).not.toBeNull();
  expect(outBox).not.toBeNull();
  expect(inBox!.width).toBe(36);
  expect(inBox!.height).toBe(36);
  expect(Math.round(outBox!.y - (inBox!.y + inBox!.height))).toBe(6);
  await expect(section.locator(".leaflet-top.leaflet-left .leaflet-control-zoom")).toHaveCount(0);
  await expect(section.locator(".leaflet-attribution-flag")).toHaveCount(0);
  const attribution = section.locator(".leaflet-control-attribution");
  await expect(attribution).toContainText("OpenStreetMap");
  await expect(attribution).toContainText("CARTO");
  await expect(attribution).not.toContainText("Leaflet");
  await expect(attribution).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const beforeZoom = await mapZoom(page);
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => mapZoom(page)).toBeGreaterThan(beforeZoom);
});

test("desktop map is draggable and edge-to-edge with the taller height", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile === true, "desktop interaction only");
  const section = await scrollToMap(page);
  const container = section.locator("[data-venue-map-container]");
  const box = await container.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - page.viewportSize()!.width)).toBeLessThanOrEqual(2);
  expect(box!.height).toBe(720);
  await expect(container).toHaveClass(/leaflet-grab/);

  const pane = section.locator(".leaflet-map-pane");
  const before = await pane.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.move(box!.x + box!.width * 0.72, box!.y + box!.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.58, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pane.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
});

test("markers are keyboard-focusable and Enter opens popups", async ({ page }) => {
  const section = await scrollToMap(page);

  await section.locator("[data-venue-map-container]").focus();
  for (let i = 0; i < 12; i += 1) {
    const active = await page.evaluate(() => document.activeElement?.className ?? "");
    if (active.includes("venue-map-marker-destination")) break;
    await page.keyboard.press("Tab");
  }
  const focusedClass = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(focusedClass).toContain("venue-map-marker-destination");
  const label = await page.evaluate(() => document.activeElement?.getAttribute("title") ?? "");
  expect(label).toBe("Graha 58 Gedung Serbaguna UMS");

  await page.keyboard.press("Enter");
  await expect(page.locator(".leaflet-popup")).toBeVisible();
});

test("keyboard: Space opens the popup and focus returns on close", async ({ page }) => {
  const section = await scrollToMap(page);

  await section.locator("[data-venue-map-container]").focus();
  for (let i = 0; i < 12; i += 1) {
    const active = await page.evaluate(() => document.activeElement?.className ?? "");
    if (active.includes("venue-map-marker-destination")) break;
    await page.keyboard.press("Tab");
  }

  await page.keyboard.press("Space");
  await expect(page.locator(".leaflet-popup")).toBeVisible();
  await closePopup(page);
  const active = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(active).toContain("venue-map-marker-destination");
});

test("route options and compact directions link are keyboard-accessible", async ({ page }) => {
  const section = await scrollToMap(page);
  const purwosari = section.getByRole("button", { name: /Purwosari:/ });
  await purwosari.focus();
  await expect(purwosari).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(purwosari).toHaveAttribute("aria-pressed", "true");

  const directions = section.getByRole("link", {
    name: "Open route from Stasiun Purwosari in Google Maps",
  });
  await expect(directions).toHaveText("Open in Google Maps");
  await directions.focus();
  await expect(directions).toBeFocused();
});

test("Leaflet chunk failure swaps to the static fallback", async ({ page }) => {
  await page.route(
    /\/src\/components\/venue-map\.ts|_astro\/venue-map\.|node_modules\/leaflet|_astro\/leaflet\./,
    (route) => route.abort(),
  );
  await page.goto("/");
  await dismissWelcomeGate(page);

  const section = page.locator("#venue-map");
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_500);
  await expect(section.locator("[data-venue-map-fallback]")).toBeVisible();
  await expect(section.locator("[data-venue-map-placeholder]")).toBeHidden({ timeout: 10_000 }); // fallback path: instant
});

test("mobile: map container allows page scroll pass-through and is full-bleed", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile !== true, "touch-primary behavior");
  const section = await scrollToMap(page);
  const container = section.locator("[data-venue-map-container]");
  const touchAction = await container.evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toBe("pan-x pan-y");
  await expect(container).not.toHaveClass(/leaflet-touch-drag/);

  const box = await container.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - page.viewportSize()!.width)).toBeLessThanOrEqual(2);
  expect(box!.height).toBe(560);
});
