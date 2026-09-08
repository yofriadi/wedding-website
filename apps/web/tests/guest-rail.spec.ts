import { test, expect, type Page, type Route } from "@playwright/test";
import { dismissWelcomeGate, seedStoryIntroSeen, skipUnlessEmptyWall } from "./helpers";

// Guest rail + add-story flow (guest-submissions 3.4/3.5/4.1/4.2/4.3) plus
// first-name attribution on real tiles (story-rail-attribution D3/D4).
//
// No-seed convention: client behavior is tested by routing /api/submissions,
// so nothing here depends on server DB state. The empty-wall cases rely on the
// scratch DB holding no photos — the SSR gate then renders the three mocks.
//
// Photo-only submissions (retire-wishes-story-intro): the flow has no wish
// input, and the tile's FIRST tap plays the example-story intro — tests that
// exercise the flow itself seed `seedStoryIntroSeen` to skip it.

const INVITE_ID = "Playwright01";

const RAIL = "[data-story-rail]"; // the flex container itself — guest tiles must land INSIDE it (story-rail-mocks 1.2)

interface Photo {
  photoUrl: string;
  thumbnailUrl: string;
}

// story-rail-attribution D7: every story entry — wall stories and `mine` —
// carries attribution. Typed OPTIONAL here so the add-story-flow fixtures
// below (which never assert on names) stay untouched; a payload that omits
// them degrades to the tile's attribution-free layout.
interface Attribution {
  firstName?: string | null;
  createdAt?: number;
}

interface Payload {
  mine: ({ id: string; photos: Photo[] } & Attribution) | null;
  inviteValid?: boolean;
  wall: { stories: ({ photos: Photo[] } & Attribution)[] };
}

function routeSubmissions(payload: Payload) {
  // The real API always answers inviteValid (server-side invite resolution).
  // Tests that don't care get a VALID invite — only the stale-cookie
  // regression test overrides it to false explicitly.
  const withDefault = { inviteValid: true, ...payload };
  return async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(withDefault),
    });
  };
}

async function gotoRail(page: Page) {
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(RAIL).scrollIntoViewIfNeeded();
}

// Distinct per entry so the tests prove attribution follows the ENTRY, not one
// shared name: thumb 1 → Lita/1h ago, thumb 2 → Rara/2h ago, thumb 3 → Tania.
const NAMES = ["Lita", "Rara", "Tania"];

const storyPayload = (photos: string[]): Payload["wall"]["stories"] =>
  photos.map((thumb, index) => ({
    photos: [{ photoUrl: `${thumb}-orig`, thumbnailUrl: thumb }],
    firstName: NAMES[index] ?? `Guest${index + 1}`,
    createdAt: Date.now() - (index + 1) * 60 * 60 * 1000,
  }));

test.describe("story rail guest tiles", () => {
  test("public: one submissions request, wall tiles rendered, no add-story tile", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/submissions") requests.push(req.url());
    });
    // No cookie: the public wall answers mine: null + the wall; the rail
    // renders wall tiles through the same path invitees use (public-wall D2).
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        wall: { stories: storyPayload(["/thumb-1.webp"]) },
      }),
    );

    await gotoRail(page);

    // Exactly one submissions request per page load (shared module instance).
    await expect.poll(() => requests.length, { timeout: 5_000 }).toBe(1);

    await expect(page.locator("[data-add-story-root]")).toHaveCount(0);
    const guestTiles = page.locator(`${RAIL} [data-guest]`);
    await expect(guestTiles).toHaveCount(1);
    await expect(guestTiles.first().locator("img")).toHaveAttribute("src", "/thumb-1.webp");
    // Anonymous viewer parity (guest-photos): a cookie-less visitor sees the
    // same first-name attribution a resolved invitee does.
    await expect(guestTiles.first().locator("span.truncate")).toHaveText("Lita");
    await expect(guestTiles.first().locator("[data-open]")).toHaveAttribute(
      "aria-label",
      "View Lita's stories",
    );

    // story-rail-mocks: wall stories evict the SSR mock tiles live (all
    // visitors run the eviction path now).
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(0);
  });

  test("public + empty wall: one submissions request, no wall tiles, mocks stay", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/submissions") requests.push(req.url());
    });
    await page.route("**/api/submissions", routeSubmissions({ mine: null, wall: { stories: [] } }));

    await skipUnlessEmptyWall(page);
    await gotoRail(page);

    await expect.poll(() => requests.length, { timeout: 5_000 }).toBe(1);

    await expect(page.locator("[data-add-story-root]")).toHaveCount(0);
    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(0);
    // Scratch DB is empty → fail-open SSR gate renders the mocks; the empty
    // wall payload evicts nothing.
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);
  });

  test("invitee + no submission: add-story tile visible, opens the photo-only flow", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route(
      "**/api/submissions",
      routeSubmissions({ mine: null, inviteValid: true, wall: { stories: [] } }),
    );
    await seedStoryIntroSeen(page);

    await gotoRail(page);

    const tile = page.locator("[data-add-story-root]");
    await expect(tile).toBeVisible();

    // One-screen flow opens: centered title, photo picker, actions. Photos are
    // the only input (retire-wishes-story-intro): no wish field anywhere.
    await page.locator("[data-add-story-open]").click();
    const flow = page.locator("#add-story-flow");
    await expect(flow).toBeVisible();
    await expect(flow.locator("h2")).toContainText("Share our stories");
    await expect(flow.locator("text=up to 3")).toBeVisible();
    await expect(page.locator("[data-photo-input]")).toBeAttached();
    await expect(page.locator("text=Choose photos")).toBeVisible();
    await expect(page.locator("[data-wish-input]")).toHaveCount(0);
    await expect(page.locator("[data-wish-count]")).toHaveCount(0);
    await expect(page.locator("[data-wish-error]")).toHaveCount(0);
    await expect(page.locator("#wish-text")).toHaveCount(0);

    // Full-screen: the panel spans the viewport.
    const flowBox = await flow.boundingBox();
    expect(flowBox!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    expect(flowBox!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);

    // Cancel before Share; no × close button.
    await expect(page.locator("[data-flow-cancel]")).toBeVisible();
    await expect(page.locator("[data-flow-close]")).toHaveCount(0);

    // Empty submit disabled — a photo is now the only thing that enables it.
    await expect(page.locator("[data-flow-submit]")).toBeDisabled();
  });

  test("invitee + mine exists: add-story tile hidden", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: { id: "AAAAAAAAAAAA", photos: [] },
        inviteValid: true,
        wall: { stories: [] },
      }),
    );

    await gotoRail(page);
    await expect(page.locator("[data-add-story-root]")).toBeHidden();
  });
  test("stale well-shaped cookie (inviteValid false): SSR renders the tile, client hides it", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // public-wall regression: the cookie passes the SSR shape check, but the
    // server cannot resolve it (deleted invite / reset DB). The payload says
    // so via inviteValid:false — the tile must not stay visible, or the flow
    // would open and every submit would 403.
    await page.route(
      "**/api/submissions",
      routeSubmissions({ mine: null, inviteValid: false, wall: { stories: [] } }),
    );

    await gotoRail(page);
    // SSR rendered it (cookie shape ok), the client hid it after the fetch.
    await expect(page.locator("[data-add-story-root]")).toBeAttached();
    await expect(page.locator("[data-add-story-root]")).toBeHidden();
    await expect(page.locator("[data-add-story-root]:not(.hidden)")).toHaveCount(0);
  });

  test("guest tiles render named, with lazy thumbnails, inside the rail", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        wall: { stories: storyPayload(["/thumb-1.webp", "/thumb-2.webp"]) },
      }),
    );

    await gotoRail(page);

    const guestTiles = page.locator(`${RAIL} [data-guest]`);
    await expect(guestTiles).toHaveCount(2);

    // Tile img renders the THUMBNAIL (not the original) with lazy+async.
    const imgs = guestTiles.locator("img");
    await expect(imgs.first()).toHaveAttribute("src", "/thumb-1.webp");
    await expect(imgs.first()).toHaveAttribute("loading", "lazy");
    await expect(imgs.first()).toHaveAttribute("decoding", "async");

    // First-name attribution (guest-photos): the label span shows the poster's
    // first name, the open button's accessible label names them, and the
    // ELEMENT carries data-username so the portaled modal can re-read it on
    // every slide change.
    await expect(guestTiles.nth(0).locator("span.truncate")).toHaveText("Lita");
    await expect(guestTiles.nth(1).locator("span.truncate")).toHaveText("Rara");
    await expect(guestTiles.nth(0).locator("[data-open]")).toHaveAttribute(
      "aria-label",
      "View Lita's stories",
    );
    await expect(guestTiles.nth(1)).toHaveAttribute("data-username", "Rara");

    // story-rail-mocks 1.2: guest tiles land INSIDE the rail container — the
    // wrapper is a DIRECT child of [data-story-rail] (this is the assertion
    // that fails against the old section-appending code).
    const wrappersAreRailChildren = await page.evaluate(() => {
      const rail = document.querySelector("[data-story-rail]");
      if (!rail) return false;
      return Array.from(rail.querySelectorAll("[data-guest]")).every(
        (el) => el.parentElement?.parentElement === rail,
      );
    });
    expect(wrappersAreRailChildren).toBe(true);

    // story-rail-attribution D1: the demo and teaser populations are retired,
    // so a non-empty wall leaves ONLY the real guest tiles in the rail —
    // nothing named "demo" exists to order against any more. Scoped to the
    // rail: the example-story intro viewer lives outside it and never joins
    // rail ordering (retire-wishes-story-intro D3/D6).
    const order = await page.evaluate(() => {
      const rail = document.querySelector("[data-story-rail]");
      return Array.from(rail?.querySelectorAll("story-viewer") ?? []).map((el) => {
        if (el.hasAttribute("data-guest")) return "guest";
        if (el.hasAttribute("data-mock")) return "mock";
        return "other";
      });
    });
    expect(order).toEqual(["guest", "guest"]);
  });

  test("null or omitted firstName on a wall story renders the attribution-free tile", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // guest-photos "Null first name falls back to attribution-free", on the
    // CLIENT-built path (the SSR mocks cover the same layout server-side): one
    // entry with an explicit null firstName (a whitespace-only display_name on
    // the server) and one from an older payload that omits the fields
    // entirely — both must degrade, never render "undefined"/"null".
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        wall: {
          stories: [
            {
              photos: [{ photoUrl: "/thumb-null-orig", thumbnailUrl: "/thumb-null.webp" }],
              firstName: null,
              createdAt: Date.now() - 60_000,
            },
            { photos: [{ photoUrl: "/thumb-old-orig", thumbnailUrl: "/thumb-old.webp" }] },
          ],
        },
      }),
    );

    await gotoRail(page);

    const tiles = page.locator(`${RAIL} [data-guest]`);
    await expect(tiles).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const tile = tiles.nth(i);
      // Transparent filler label, neutral accessible name, no data-username.
      const label = tile.locator("span.truncate");
      await expect(label).toHaveText(".");
      await expect(label).toHaveAttribute("aria-hidden", "true");
      await expect(tile.locator("[data-open]")).toHaveAttribute("aria-label", "View guest story");
      expect(await tile.locator("[data-username]").count()).toBe(0);
    }

    // The modal's attribution slot is EMPTY for an unnamed entry — no "Guest
    // story" text (retire-wishes-story-intro D7) — even though the first entry
    // DOES carry a createdAt: a null firstName wins the whole layout. The
    // close button stays right-aligned.
    await tiles.first().locator("[data-open]").click();
    const modal = page.locator('body > [data-modal][aria-hidden="false"]');
    await expect(modal).toHaveCount(1);
    await expect(modal.getByText("Guest story")).toHaveCount(0);
    expect(await modal.locator("[data-username]").count()).toBe(0);
    expect(await modal.locator("[data-timestamp]").count()).toBe(0);
    expect(await modal.locator("[data-avatar]").count()).toBe(0);

    const closeBox = await modal.locator("[data-close]").boundingBox();
    const panelBox = await modal.locator("[data-panel]").boundingBox();
    expect(closeBox!.x).toBeGreaterThan(panelBox!.x + panelBox!.width / 2);
  });

  test("hand-off flows from the first guest tile to the second (wall tiles chain)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        wall: { stories: storyPayload(["/thumb-1.webp", "/thumb-2.webp"]) },
      }),
    );
    // The guest originals must actually load: the readiness hand-off gates on
    // img.onload. Serve a real 1×1 webp for the fake originals.
    const TINY_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
    await page.route("**/*-orig", (route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: TINY_WEBP }),
    );

    await gotoRail(page);
    const guestTiles = page.locator(`${RAIL} [data-guest]`);
    await expect(guestTiles).toHaveCount(2);
    // story-rail-mocks 3.4: barrier — the mocks must be fully evicted before
    // any story-viewer-end fires, or the hand-off lands on a still-attached
    // mock instead of the next guest tile and modalSrc fails.
    await expect(page.locator("[data-mock]")).toHaveCount(0);

    // Open the FIRST guest tile: one photo each, so its only slide is already
    // the end-of-viewer boundary. A right-side tap fires story-viewer-end and
    // the orchestrator's viewers.indexOf ordering hands off to the next tile.
    await guestTiles.first().locator("[data-open]").click();

    const openModal = page.locator('[data-modal][aria-hidden="false"]');
    await expect(openModal).toHaveCount(1);

    const stage = openModal.locator("[data-stage]");
    const box = await stage.boundingBox();
    if (!box) throw new Error("stage not visible");
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    // Give the hand-off's readiness hand-shake room (fallback close is 800ms).
    await page.waitForTimeout(1200);

    // After the hand-off the OPEN modal belongs to the SECOND guest viewer.
    await expect(openModal).toHaveCount(1);
    const modalSrc = await openModal.locator("[data-stage] img").first().getAttribute("src");
    expect(modalSrc).toBe("/thumb-2.webp-orig"); // story original, not the thumbnail
    // And it carries the second poster's attribution: name + relative time,
    // with no avatar circle (a guest tile has no avatar to show).
    await expect(openModal.locator("[data-username]")).toHaveText("Rara");
    await expect(openModal.locator("[data-timestamp]")).toContainText(/ago/);
    await expect(openModal.locator("[data-avatar]")).toHaveCount(0);
  });

  test("dynamically-inserted guest story opens in the modal (hand-off wiring intact)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        wall: { stories: storyPayload(["/thumb-1.webp"]) },
      }),
    );

    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(1);

    // Open the dynamically-inserted guest tile.
    await page.locator(`${RAIL} [data-guest] [data-open]`).click();

    // The guest's modal (portaled to body) is the visible one: aria-hidden
    // flips to false only on the open viewer.
    const modal = page.locator('body > [data-modal][aria-hidden="false"]');
    await expect(modal).toHaveCount(1);
    await expect(modal.locator("img").first()).toBeVisible();

    // Author header (story-rail-attribution D4): the poster's first name and a
    // relative timestamp — and NO avatar circle, because a guest tile has
    // none to show (an unnamed entry gets the EMPTY attribution slot instead).
    await expect(modal.locator("[data-username]")).toHaveText("Lita");
    await expect(modal.locator("[data-timestamp]")).toContainText(/ago/);
    expect(await modal.locator("[data-avatar]").count()).toBe(0);
    // The tile's own label names the poster as well.
    await expect(page.locator(`${RAIL} [data-guest] span.truncate`).first()).toHaveText("Lita");
  });

  // story-rail-mocks 3.5: mocks are the DEFAULT test condition (scratch DB is
  // empty → the SSR gate fails open) — these cover gate-render, live eviction,
  // and the disconnect-path cleanup.
  test("invitee + empty wall: three unnamed mocks are the rail's only tiles", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route("**/api/submissions", routeSubmissions({ mine: null, wall: { stories: [] } }));

    await skipUnlessEmptyWall(page);
    await gotoRail(page);

    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);
    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(0);

    // Mocks are interactive previews, but UNNAMED ones: attribution belongs to
    // real stories only, so the accessible label stays neutral.
    const mockTiles = page.locator(`${RAIL} [data-mock]`);
    await expect(mockTiles.first().locator("[data-open]")).toHaveAttribute(
      "aria-label",
      "View guest story",
    );
    await mockTiles.first().locator("[data-open]").click();
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(1);

    // DOM order: nothing precedes or follows the mocks — the demo and teaser
    // populations are retired, so the RAIL's story-viewers are exactly these
    // three (the add-story tile is not a story-viewer, and the example intro
    // viewer lives outside the rail).
    const order = await page.evaluate(() => {
      const rail = document.querySelector("[data-story-rail]");
      return Array.from(rail?.querySelectorAll("story-viewer") ?? []).map((el) => {
        if (el.hasAttribute("data-guest")) return "guest";
        if (el.hasAttribute("data-mock")) return "mock";
        return "other";
      });
    });
    expect(order).toEqual(["mock", "mock", "mock"]);
  });

  test("own tile renders on initial load (reload persistence, sole submitter)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // The sole real story is the caller's own: the SSR gate can't know that
    // (cookie-blind), so mocks render server-side and the client evicts them
    // once the fetch resolves — leaving the caller's own tile, not an empty
    // guest strip.
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: {
          id: "AAAAAAAAAAAA",
          photos: [{ photoUrl: "/x-orig-own", thumbnailUrl: "/thumb-own.webp" }],
          firstName: "Yofri",
          createdAt: Date.now() - 30 * 60 * 1000,
        },
        wall: { stories: [] },
      }),
    );

    await gotoRail(page);

    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(1);
    await expect(page.locator("[data-mock]")).toHaveCount(0);
    // The own tile renders the caller's thumbnail AND their first name —
    // `mine` carries attribution exactly like a wall story does.
    const img = page.locator(`${RAIL} [data-guest] img`).first();
    await expect(img).toHaveAttribute("src", "/thumb-own.webp");
    await expect(page.locator(`${RAIL} [data-guest] span.truncate`).first()).toHaveText("Yofri");
  });

  test("posting photos evicts mocks and re-renders the full wall without reload", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route("**/api/submissions", routeSubmissions({ mine: null, wall: { stories: [] } }));
    await seedStoryIntroSeen(page);

    await skipUnlessEmptyWall(page);
    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);

    // Post through the real flow (a raw submissions:posted dispatch wouldn't
    // invalidate the cached GET payload): route POST 201 + the fresh re-sync
    // GET with wall stories AND mine's photos.
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "BBBBBBBBBBBB", photos: [] }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mine: {
              id: "BBBBBBBBBBBB",
              photos: [{ photoUrl: "/x-orig-mine", thumbnailUrl: "/thumb-mine.webp" }],
              firstName: "Yofri",
              createdAt: Date.now() - 5 * 60 * 1000,
            },
            inviteValid: true,
            wall: {
              stories: storyPayload(["/thumb-a.webp"]),
            },
          }),
        });
      }
    });

    await page.locator("[data-add-story-open]").click();
    await page.setInputFiles("[data-photo-input]", {
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await page.locator("[data-flow-submit]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");

    // Mocks evicted; wall + own tile rendered — all without a reload — and
    // each tile carries its OWN attribution (wall story first, then `mine`).
    await expect(page.locator("[data-mock]")).toHaveCount(0);
    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(2);
    const srcs = await page
      .locator(`${RAIL} [data-guest] img`)
      .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).getAttribute("src")));
    expect(srcs).toEqual(["/thumb-a.webp", "/thumb-mine.webp"]);
    const labels = await page
      .locator(`${RAIL} [data-guest] span.truncate`)
      .evaluateAll((spans) => spans.map((span) => span.textContent));
    expect(labels).toEqual(["Lita", "Yofri"]);
  });

  test("eviction while a mock's modal is open cleans up scroll lock and modal", async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await seedStoryIntroSeen(page);
    // Adversarial-review fix: drive the REAL eviction path (POST →
    // invalidateSubmissions → submissions:posted → refetch → syncMockTiles),
    // not a manual DOM removal. The post-POST re-sync GET is DELAYED so the
    // mock's modal can be opened while the fresh payload is still in flight;
    // its `mine` photos then evict the mocks out from under the open modal.
    let posted = false;
    let releaseResync: (() => void) | undefined;
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        posted = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "BBBBBBBBBBBB", photos: [] }),
        });
      } else if (posted) {
        // Hold the re-sync GET until the test opens the mock's modal.
        await new Promise<void>((resolve) => {
          releaseResync = resolve;
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mine: {
              id: "BBBBBBBBBBBB",
              photos: [{ photoUrl: "/x-orig-mine", thumbnailUrl: "/thumb-mine.webp" }],
            },
            inviteValid: true,
            wall: { stories: [] },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mine: null,
            inviteValid: true,
            wall: { stories: [] },
          }),
        });
      }
    });

    await skipUnlessEmptyWall(page);
    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);

    // Post a photo through the real flow: the re-sync GET is now pending.
    await page.locator("[data-add-story-open]").click();
    await page.setInputFiles("[data-photo-input]", {
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await page.locator("[data-flow-submit]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");

    // While the re-sync is in flight, open the first mock's story modal — its
    // only slide (/story_example_1.webp) may still be loading (spinner up, no
    // progress timer yet).
    await page.locator(`${RAIL} [data-mock] [data-open]`).first().click();
    const modal = page.locator('body > [data-modal][aria-hidden="false"]');
    await expect(modal).toHaveCount(1);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    // Late-onload probe — wire it BEFORE the eviction: events dispatched on
    // a DETACHED node do not bubble to document, so only element-level
    // listeners (attached while the mocks are still in the DOM) can see a
    // wrongful dispatch. Also stash the OPEN modal's current slide <img> —
    // after eviction we dispatch a synthetic `load` on it, which invokes the
    // component's property-mode img.onload exactly like a browser that fires
    // load late (Chromium usually suppresses the real event once the element
    // is out of the document, so the synthetic dispatch is the deterministic
    // way to exercise the D3 guard).
    let detachedEndCount = 0;
    await page.exposeFunction("noteDetachedEnd", () => {
      detachedEndCount++;
    });
    await page.evaluate(() => {
      document.querySelectorAll("[data-mock]").forEach((el) => {
        el.addEventListener("story-viewer-end", () => (window as any).noteDetachedEnd());
      });
      (window as any).__evictedSlide = document.querySelector(
        '[data-modal][aria-hidden="false"] [data-stage] img',
      );
      // First progress bar of the OPEN mock modal — startImageProgress()
      // drives bar.style.transform; if a timer resurrects on the detached
      // viewer, this bar starts moving again within one 50ms tick. (The
      // bars are portaled to body WITH the modal, so stash from the open
      // modal, not from the tile.)
      (window as any).__evictedBar = document
        .querySelector('[data-modal][aria-hidden="false"]')
        ?.querySelector("[data-progress-bar]");
    });

    // Release the re-sync: syncMockTiles evicts the mocks while the modal
    // is open.
    releaseResync?.();
    await expect(page.locator("[data-mock]")).toHaveCount(0);

    // Mocks (wrapper and all) are gone; the evicted mock's modal was
    // force-closed and removed from body (no OPEN modal anywhere); scroll is
    // restored; the caller's own tile rendered; nothing threw.
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(1);

    // The late onload itself: dispatch `load` on the detached slide img —
    // a property-mode onload handler cannot distinguish this from a browser
    // that delivers the load event after the element left the document
    // (Chromium usually suppresses the real event; the dispatch is the
    // deterministic equivalent). With the D3 guard this is a no-op.
    const beforeDrift = await page.evaluate(() => {
      (window as any).__evictedSlide?.dispatchEvent(new Event("load"));
      const bar = (window as any).__evictedBar as HTMLElement | undefined;
      return bar?.style.transform ?? null;
    });
    await page.waitForTimeout(600);
    const afterDrift = await page.evaluate(() => {
      const bar = (window as any).__evictedBar as HTMLElement | undefined;
      return bar?.style.transform ?? null;
    });
    expect(afterDrift).toBe(beforeDrift); // no resurrected progress interval
    expect(detachedEndCount).toBe(0);
    expect(errors).toHaveLength(0);
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
  });

  test("hand-off chains the mocks and the scroll lock survives it (empty wall)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route("**/api/submissions", routeSubmissions({ mine: null, wall: { stories: [] } }));

    await skipUnlessEmptyWall(page);
    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);

    // Open the FIRST mock and advance past its only slide: the hand-off must
    // land on the SECOND mock in rail order (D9 — single-story mocks chain
    // like a real three-post rail, there are no demo tiles left to anchor on).
    await page.locator(`${RAIL} [data-mock] [data-open]`).first().click();

    const openModal = page.locator('[data-modal][aria-hidden="false"]');
    await expect(openModal).toHaveCount(1);

    const stage = openModal.locator("[data-stage]");
    const box = await stage.boundingBox();
    if (!box) throw new Error("stage not visible");
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.waitForTimeout(1200);

    // After the hand-off the OPEN modal belongs to the second mock. Scoped to
    // [data-stage] so a future author-avatar can never satisfy it by accident.
    await expect(openModal).toHaveCount(1);
    const modalSrc = await openModal.locator("[data-stage] img").first().getAttribute("src");
    expect(modalSrc).toBe("/story_example_2.webp"); // second mock's only story

    // Adversarial-review fix regression: the outgoing viewer's close() used
    // to drop the body scroll lock mid-hand-off while the incoming modal was
    // still open — the lock must survive until the LAST modal closes.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(openModal).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
});

// retire-wishes-story-intro D3/D4/D5: the add-story tile's FIRST activation per
// browser plays the three example stories, then opens the flow when the last
// one ends. Later taps open the flow directly, and a tap while the rail's mock
// tiles are still there skips the intro without marking it seen — the mocks ARE
// its content; it only plays once real posts have evicted them. The intro
// viewer is always in the DOM (outside the rail, no data-mock), so it survives
// mock eviction.
test.describe("add-story first-tap intro", () => {
  const EXAMPLES = [
    "/story_example_1.webp",
    "/story_example_2.webp",
    "/story_example_3.webp",
  ] as const;

  async function railWithTile(page: Page, context: import("@playwright/test").BrowserContext) {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // Non-empty wall: the intro only plays once the rail's mock tiles are GONE,
    // and syncMockTiles evicts any SSR mocks when this payload lands — so the
    // intro-eligible state holds regardless of the scratch DB's SSR gate.
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        inviteValid: true,
        wall: { stories: storyPayload(["/thumb-1.webp"]) },
      }),
    );
    await gotoRail(page);
    await expect(page.locator("[data-add-story-root]")).toBeVisible();
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(0);
  }

  const introFlag = (page: Page) =>
    page.evaluate(() => localStorage.getItem("ww-story-intro-seen"));

  test("first tap skips the intro while the mock tiles still sit in the rail", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await page.route(
      "**/api/submissions",
      routeSubmissions({ mine: null, inviteValid: true, wall: { stories: [] } }),
    );
    await skipUnlessEmptyWall(page);
    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);

    // The mocks ARE the intro content, visible and tappable right there: the
    // tap goes straight to the flow — no fullscreen replay…
    await page.locator("[data-add-story-open]").click();
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "false");
    // …and the skip does NOT mark the intro seen, so it can still play the
    // first time the rail no longer shows the mocks.
    expect(await introFlag(page)).toBeNull();
  });
  test("first tap plays the intro, and watching it through opens the flow", async ({
    page,
    context,
  }) => {
    await railWithTile(page, context);
    expect(await introFlag(page)).toBeNull();

    // First tap: the intro opens instead of the flow.
    await page.locator("[data-add-story-open]").click();
    const modal = page.locator('body > [data-modal][aria-hidden="false"]');
    await expect(modal).toHaveCount(1);
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    expect(await modal.locator("[data-stage] img").first().getAttribute("src")).toBe(EXAMPLES[0]);
    // Three slides in ONE viewer: three progress segments, not three tiles.
    await expect(modal.locator("[data-progress-item]")).toHaveCount(3);
    // The flag is set on OPEN (D4), so bailing out early still counts.
    expect(await introFlag(page)).toBe("1");

    // Tap through the three examples; ending the last one closes the intro and
    // opens the flow (D5).
    const stage = modal.locator("[data-stage]");
    for (let i = 1; i < EXAMPLES.length; i++) {
      const box = await stage.boundingBox();
      await page.mouse.click(box!.x + box!.width * 0.75, box!.y + box!.height / 2);
      await expect
        .poll(() => modal.locator("[data-stage] img").first().getAttribute("src"))
        .toBe(EXAMPLES[i]);
    }
    const lastBox = await stage.boundingBox();
    await page.mouse.click(lastBox!.x + lastBox!.width * 0.75, lastBox!.y + lastBox!.height / 2);

    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("#add-story-flow")).toBeVisible();
    // The intro modal closed — no story modal is left open behind the flow…
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
    // …and the flow owns the scroll lock (D5's sync-close guards this).
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  });

  test("bailing out of the intro does not open the flow; the next tap does", async ({
    page,
    context,
  }) => {
    await railWithTile(page, context);

    await page.locator("[data-add-story-open]").click();
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(1);

    // Escape closes the intro WITHOUT firing story-viewer-end → no flow.
    await page.keyboard.press("Escape");
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    // The intro is marked seen, so the next tap goes straight to the flow.
    await page.locator("[data-add-story-open]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
  });

  test("the flag persists across reloads: later taps open the flow directly", async ({
    page,
    context,
  }) => {
    await railWithTile(page, context);
    await page.locator("[data-add-story-open]").click();
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(1);
    await page.keyboard.press("Escape");

    // Same browser context, fresh page load: the flag survives.
    await gotoRail(page);
    expect(await introFlag(page)).toBe("1");
    await page.locator("[data-add-story-open]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator('body > [data-modal][aria-hidden="false"]')).toHaveCount(0);
  });

  test("intro survives mock eviction: reachable on a non-empty wall", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // Non-empty wall: the SSR gate renders no mocks and the client evicts any
    // that were server-rendered. The intro viewer carries no data-mock, so it
    // must still be there — this is the whole point of the change.
    await page.route(
      "**/api/submissions",
      routeSubmissions({
        mine: null,
        inviteValid: true,
        wall: { stories: storyPayload(["/thumb-1.webp"]) },
      }),
    );
    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(1);
    await expect(page.locator("[data-mock]")).toHaveCount(0);
    await expect(page.locator("[data-story-intro] [data-story-viewer]")).toHaveCount(1);

    await page.locator("[data-add-story-open]").click();
    const modal = page.locator('body > [data-modal][aria-hidden="false"]');
    await expect(modal).toHaveCount(1);
    expect(await modal.locator("[data-stage] img").first().getAttribute("src")).toBe(EXAMPLES[0]);
    await expect(modal.locator("[data-progress-item]")).toHaveCount(3);
  });

  test("rail hand-off never chains into the intro viewer", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await seedStoryIntroSeen(page); // not testing the tile here
    await page.route("**/api/submissions", routeSubmissions({ mine: null, wall: { stories: [] } }));

    await skipUnlessEmptyWall(page);
    await gotoRail(page);
    await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);

    // Advance past the LAST rail mock: hand-off is rail-scoped (D6), so this
    // must simply close — not open the example intro.
    await page.locator(`${RAIL} [data-mock] [data-open]`).last().click();
    const openModal = page.locator('[data-modal][aria-hidden="false"]');
    await expect(openModal).toHaveCount(1);
    expect(await openModal.locator("[data-stage] img").first().getAttribute("src")).toBe(
      EXAMPLES[2],
    );

    const box = await openModal.locator("[data-stage]").boundingBox();
    await page.mouse.click(box!.x + box!.width * 0.75, box!.y + box!.height / 2);

    await expect(page.locator('[data-modal][aria-hidden="false"]')).toHaveCount(0);
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
});

test.describe("add-story flow", () => {
  async function openFlow(page: Page, payload: Payload) {
    await page.route("**/api/submissions", routeSubmissions(payload));
    await seedStoryIntroSeen(page);
    await gotoRail(page);
    await page.locator("[data-add-story-open]").click();
    await expect(page.locator("#add-story-flow")).toBeVisible();
  }

  test("photos can be removed: per-photo button, Remove all, and close resets", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await openFlow(page, { mine: null, wall: { stories: [] } });

    // Two photos: preview list + Remove all visible + submit enabled.
    await page.setInputFiles("[data-photo-input]", [
      { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(8) },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(8) },
    ]);
    await expect(page.locator("[data-photo-list] li")).toHaveCount(2);
    await expect(page.locator("[data-photo-clear]")).toBeVisible();
    await expect(page.locator("[data-flow-submit]")).toBeEnabled();

    // Previews fill the row: three grid columns share the full width, and
    // each tile keeps the story tile's 9:16 ratio.
    const listBox = await page.locator("[data-photo-list]").boundingBox();
    const first = await page.locator("[data-photo-list] li").first().boundingBox();
    expect(first).toBeTruthy();
    expect(first!.width).toBeGreaterThan((listBox!.width / 3) * 0.9); // ~1/3 of row
    expect(first!.height / first!.width).toBeCloseTo(16 / 9, 1);
    // "Remove all" sits on the row's far right, "up to 3" on its far left.
    const clearBox = await page.locator("[data-photo-clear]").boundingBox();
    const upToBox = await page.locator("text=up to 3").boundingBox();
    expect(upToBox!.x).toBeLessThan(listBox!.x + 40);
    expect(clearBox!.x + clearBox!.width).toBeGreaterThan(listBox!.x + listBox!.width - 40);

    // Per-photo remove: one gone, submit stays enabled with one left.
    await page.locator("[data-photo-list] li").first().locator("button").click();
    await expect(page.locator("[data-photo-list] li")).toHaveCount(1);
    await expect(page.locator("[data-flow-submit]")).toBeEnabled();

    // Remove all: list empty, control hidden, submit disabled.
    await page.locator("[data-photo-clear]").click();
    await expect(page.locator("[data-photo-list] li")).toHaveCount(0);
    await expect(page.locator("[data-photo-clear]")).toBeHidden();
    await expect(page.locator("[data-flow-submit]")).toBeDisabled();

    // Close (Escape) resets: re-open starts with an empty picker.
    await page.setInputFiles("[data-photo-input]", {
      name: "c.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await expect(page.locator("[data-photo-list] li")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    await page.locator("[data-add-story-open]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("[data-photo-list] li")).toHaveCount(0);
    await expect(page.locator("[data-flow-submit]")).toBeDisabled();
  });

  test("photo submit posts the photos, closes the flow, and hides the tile", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await openFlow(page, { mine: null, wall: { stories: [] } });

    // A photo is the ONLY thing that enables submit (photo-only flow).
    await expect(page.locator("[data-flow-submit]")).toBeDisabled();
    await page.setInputFiles("[data-photo-input]", {
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await expect(page.locator("[data-photo-list] li")).toHaveCount(1);
    await expect(page.locator("[data-flow-submit]")).toBeEnabled();

    const posts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/submissions") {
        posts.push(req.postData() ?? "");
      }
    });
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "DDDDDDDDDDDD", photos: [] }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mine: { id: "DDDDDDDDDDDD", photos: [] },
            inviteValid: true,
            wall: { stories: [] },
          }),
        });
      }
    });

    await page.locator("[data-flow-submit]").click();
    // Flow closes (inert state), tile disappears (mine now exists).
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#add-story-flow")).toHaveClass(/pointer-events-none/);
    await expect(page.locator("[data-add-story-root]")).toBeHidden();

    expect(posts.length).toBeGreaterThan(0);
    // Photo multipart part present, and no wish part exists any more.
    expect(posts[0]).toContain('name="photos"');
    expect(posts[0]).not.toContain('name="wishText"');
  });

  test("400 maps to inline error and the flow stays open", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await openFlow(page, { mine: null, wall: { stories: [] } });

    await page.setInputFiles("[data-photo-input]", {
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "empty_submission" }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.locator("[data-flow-submit]").click();
    await expect(page.locator("[data-flow-error]")).toBeVisible();
    await expect(page.locator("[data-flow-error]")).toContainText("Add at least one photo");
    await expect(page.locator("#add-story-flow")).toBeVisible();
  });

  test("network failure keeps the flow open with a retry", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await openFlow(page, { mine: null, wall: { stories: [] } });

    await page.setInputFiles("[data-photo-input]", {
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
      } else {
        await route.fallback();
      }
    });

    await page.locator("[data-flow-submit]").click();
    await expect(page.locator("[data-flow-error]")).toBeVisible();
    await expect(page.locator("#add-story-flow")).toBeVisible();
    await expect(page.locator("[data-flow-submit]")).toBeEnabled();
  });

  test("409 maps to the already-posted state (flow closes, tile gone)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await openFlow(page, { mine: null, wall: { stories: [] } });

    await page.setInputFiles("[data-photo-input]", {
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(8),
    });
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "already_posted" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mine: { id: "CCCCCCCCCCCC", photos: [] },
            inviteValid: true,
            wall: { stories: [] },
          }),
        });
      }
    });

    await page.locator("[data-flow-submit]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#add-story-flow")).toHaveClass(/pointer-events-none/);
    await expect(page.locator("[data-add-story-root]")).toBeHidden();
  });
});
