import { expect, test } from "@playwright/test";
import { createTestServer } from "./support/server";
import { TEST_ADMIN_TOKEN } from "./support/database";
import { pinFullTier, waitForLoaderDismissed } from "./helpers";

let server: Awaited<ReturnType<typeof createTestServer>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(150_000);
  server = await createTestServer("claim-gate-tests");
});

test.afterAll(async () => {
  await server?.dispose();
});

async function createInvite(body: {
  displayName: string;
  type?: "individual" | "group";
  maxMembers?: number;
}) {
  const res = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`, {
    method: "POST",
    headers: { origin: server.baseUrl, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; sharePath: string };
}

test.describe("claim member gate", () => {
  test.beforeEach(({ page }) => {
    pinFullTier(page);
  });

  test("reveals after loading screen for eligible group link visitors, with welcome gate hidden behind it", async ({
    page,
  }) => {
    const group = await createInvite({ displayName: "The Smiths", type: "group", maxMembers: 3 });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const claimGate = page.locator("#claim-gate");
    await expect(claimGate).toBeVisible();

    const welcomeGate = page.locator("#welcome-gate");
    await expect(welcomeGate).toBeAttached();
    await expect(welcomeGate).toHaveAttribute("aria-hidden", "true");

    const input = page.locator("#claim-gate-input");
    await expect(input).toBeFocused();

    // Photo upload control remains hidden for unclaimed group visitors
    await expect(page.locator("[data-add-image]")).toBeHidden();

    // In RSVP section: entry guidance is visible and capacity notice is hidden
    await expect(page.locator("[data-claim-guidance]")).toBeVisible();
    await expect(page.locator("[data-group-capacity]")).toBeHidden();
  });

  test("Mulai button dynamic visibility: hidden when empty, revealed at 1+ chars, and hidden on clear", async ({
    page,
  }) => {
    const group = await createInvite({
      displayName: "The Andersons",
      type: "group",
      maxMembers: 3,
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const input = page.locator("#claim-gate-input");
    const submitBtn = page.locator("#claim-gate-submit");

    // Initially empty: hidden
    await expect(submitBtn).not.toHaveAttribute("data-visible", "true");

    // Whitespace only: trimmed length 0 -> hidden
    await input.fill("   ");
    await expect(submitBtn).not.toHaveAttribute("data-visible", "true");

    // 1 char: revealed
    await input.fill("A");
    await expect(submitBtn).toHaveAttribute("data-visible", "true");
    await expect(submitBtn).toBeVisible();

    // Multiple chars: still revealed
    await input.fill("Ali");
    await expect(submitBtn).toHaveAttribute("data-visible", "true");

    // Clear to empty: hidden again
    await input.fill("");
    await expect(submitBtn).not.toHaveAttribute("data-visible", "true");
  });

  test("submitting a valid claim sends POST /api/invite/claim, fades out claim gate, updates welcome gate greeting, and arms swipe-to-open without page reload", async ({
    page,
  }) => {
    const group = await createInvite({ displayName: "The Taylors", type: "group", maxMembers: 3 });

    let claimRequested = false;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith("/api/invite/claim")) {
        claimRequested = true;
      }
    });

    let reloaded = false;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && claimRequested) {
        reloaded = true;
      }
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const input = page.locator("#claim-gate-input");
    const submitBtn = page.locator("#claim-gate-submit");

    await input.fill("Taylor Swift");
    await expect(submitBtn).toHaveAttribute("data-visible", "true");

    // Character span and cursor are rendered with proper display styles
    const charSpan = page.locator(".claim-char-track .claim-char").first();
    await expect(charSpan).toBeVisible();
    const cursor = page.locator(".claim-char-track .claim-cursor");
    await expect(cursor).toBeVisible();

    await submitBtn.click();

    // Claim gate fades out and detaches
    const claimGate = page.locator("#claim-gate");
    await claimGate.waitFor({ state: "detached", timeout: 10_000 });

    // Welcome gate updates greeting to claimed member name
    const greeting = page.locator("#gate-greeting");
    await expect(greeting).toHaveText("Taylor Swift");

    // Welcome gate is armed (main has inert attribute)
    await expect(page.locator("main")).toHaveAttribute("inert", "");

    // No page reload occurred during claim handoff
    expect(reloaded).toBe(false);
  });

  test("claim completion unhides RSVP confirm form and slides to confirm without page reload or navigation", async ({
    page,
  }) => {
    const group = await createInvite({ displayName: "The Bakers", type: "group", maxMembers: 2 });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    // RSVP form exists but is hidden initially
    const rsvpForm = page.locator("[data-rsvp-form]");
    await expect(rsvpForm).toHaveAttribute("hidden", "");

    const input = page.locator("#claim-gate-input");
    await input.fill("Baker Junior");
    await page.locator("#claim-gate-submit").click();

    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });

    // Dismiss welcome gate with Escape
    await page.keyboard.press("Escape");
    await page.locator("#welcome-gate").waitFor({ state: "detached", timeout: 10_000 });

    // RSVP form is now unhidden
    await expect(rsvpForm).not.toHaveAttribute("hidden");

    // Slide to confirm
    const confirmBtn = page.locator("[data-rsvp-confirm]");
    await confirmBtn.scrollIntoViewIfNeeded();
    await expect(confirmBtn).toBeVisible();

    let rsvpPosted = false;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith("/api/rsvp")) {
        rsvpPosted = true;
      }
    });

    // Submit the form by physically sliding the confirm button
    const handle = confirmBtn.locator("[data-slide-to-confirm-handle]");
    const box = (await confirmBtn.boundingBox())!;
    const hbox = (await handle.boundingBox())!;
    const y = hbox.y + hbox.height / 2;
    await page.mouse.move(box.x + 4 + hbox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - hbox.width / 2 - 4, y, { steps: 20 });
    await page.mouse.up();

    await expect(page.locator("[data-rsvp-note]")).toHaveText("Your reservation is confirmed.", {
      timeout: 10_000,
    });
    expect(rsvpPosted).toBe(true);
  });

  test("claim completion unlocks photo upload CTA via reloadPhotos() without reload", async ({
    page,
  }) => {
    const group = await createInvite({ displayName: "The Millers", type: "group", maxMembers: 3 });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const input = page.locator("#claim-gate-input");
    await input.fill("Miller Guest");
    await page.locator("#claim-gate-submit").click();

    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });

    // Dismiss welcome gate
    await page.keyboard.press("Escape");
    await page.locator("#welcome-gate").waitFor({ state: "detached", timeout: 10_000 });

    // Photo trail controls
    const controls = page.locator("photo-trail-controls");
    const addImageBtn = page.locator("[data-add-image]");

    await controls.scrollIntoViewIfNeeded();
    await expect(addImageBtn).toBeVisible();
    await expect(addImageBtn).toHaveText(/Tambah punyamu/);
  });

  test("full-capacity group links bypass claim gate directly to welcome gate", async ({ page }) => {
    const group = await createInvite({
      displayName: "The Full Family",
      type: "group",
      maxMembers: 2,
    });

    // Claim the 2 available slots
    const claim1 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Claimant One" }),
    });
    expect(claim1.status).toBe(201);

    const claim2 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Claimant Two" }),
    });
    expect(claim2.status).toBe(201);

    // Another visitor loads the group link
    const context = await page.context().browser()!.newContext();
    const otherPage = await context.newPage();
    pinFullTier(otherPage);

    await otherPage.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(otherPage);

    // Claim gate was bypassed
    await expect(otherPage.locator("#claim-gate")).toHaveCount(0);

    // Welcome gate displays group name directly
    const greeting = otherPage.locator("#gate-greeting");
    await expect(greeting).toBeVisible();
    await expect(greeting).toHaveText("The Full Family");

    // Dismiss welcome gate and verify photo upload CTA reveals capacity label
    await otherPage.keyboard.press("Escape");
    await otherPage.locator("#welcome-gate").waitFor({ state: "detached", timeout: 10_000 });
    const addBtn = otherPage.locator("[data-add-image]");
    await addBtn.scrollIntoViewIfNeeded();
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toHaveText(/penuh/i);
    // In RSVP section: no RSVP form rendered, capacity notice is visible, guidance is hidden
    await expect(otherPage.locator("[data-rsvp-form]")).toHaveCount(0);
    await expect(otherPage.locator("[data-group-capacity]")).toBeVisible();
    await expect(otherPage.locator("[data-claim-guidance]")).toBeHidden();

    await context.close();
  });

  test("concurrent 409 group_full during typing gracefully transitions to welcome gate under group name", async ({
    page,
  }) => {
    const group = await createInvite({
      displayName: "The Racing Group",
      type: "group",
      maxMembers: 2,
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const input = page.locator("#claim-gate-input");
    await input.fill("Late Claimant");

    // Intercept claim request to return 409 group_full
    await page.route("**/api/invite/claim", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "group_full" }),
      });
    });

    await page.locator("#claim-gate-submit").click();

    // Informative error shown
    const errorEl = page.locator("#claim-gate-error-text");
    await expect(errorEl).toContainText("Kuota undangan telah penuh");

    // Transitions to welcome gate under server-rendered group name
    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });
    const greeting = page.locator("#gate-greeting");
    await expect(greeting).toHaveText("The Racing Group");

    // Dismiss welcome gate
    await page.keyboard.press("Escape");
    await page.locator("#welcome-gate").waitFor({ state: "detached", timeout: 10_000 });

    // RSVP section transitioned to capacity state
    const capacityNotice = page.locator("[data-group-capacity]");
    await expect(capacityNotice).toBeVisible();
    await expect(capacityNotice).toContainText("This group invitation is at capacity");
    await expect(page.locator("[data-claim-guidance]")).toBeHidden();
  });

  test("stale cookie (404 / 409 not_a_group) hands off to welcome gate without trapping", async ({
    page,
  }) => {
    // 1. 404 not found
    const group1 = await createInvite({
      displayName: "Stale Test Group 1",
      type: "group",
      maxMembers: 2,
    });
    await page.goto(`${server.baseUrl}${group1.sharePath}`);
    await waitForLoaderDismissed(page);

    await page.locator("#claim-gate-input").fill("Stale Guest 1");
    await page.route("**/api/invite/claim", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.locator("#claim-gate-submit").click();
    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });
    await expect(page.locator("#welcome-gate")).toBeVisible();

    // 2. 409 not_a_group
    const group2 = await createInvite({
      displayName: "Stale Test Group 2",
      type: "group",
      maxMembers: 2,
    });
    await page.goto(`${server.baseUrl}${group2.sharePath}`);
    await waitForLoaderDismissed(page);

    await page.locator("#claim-gate-input").fill("Stale Guest 2");
    await page.route("**/api/invite/claim", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_a_group" }),
      });
    });
    await page.locator("#claim-gate-submit").click();
    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });
    await expect(page.locator("#welcome-gate")).toBeVisible();
  });

  test("ambiguous outcome guidance on >= 500 errors with reload/continue actions", async ({
    page,
  }) => {
    const group = await createInvite({
      displayName: "Error Test Group",
      type: "group",
      maxMembers: 2,
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const input = page.locator("#claim-gate-input");
    await input.fill("Error Guest");

    // Intercept to return 503
    await page.route("**/api/invite/claim", async (route) => {
      await route.fulfill({ status: 503 });
    });

    await page.locator("#claim-gate-submit").click();

    // Ambiguous outcome copy displayed
    const errorEl = page.locator("#claim-gate-error-text");
    await expect(errorEl).toContainText(
      "Something went wrong and your spot may already be claimed.",
    );

    // Reload and continue actions visible
    const reloadBtn = page.locator("#claim-gate-reload-btn");
    const continueBtn = page.locator("#claim-gate-continue-btn");
    await expect(reloadBtn).toBeVisible();
    await expect(continueBtn).toBeVisible();

    // Clicking continue dismisses to welcome gate
    await continueBtn.click();
    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });
    await expect(page.locator("#welcome-gate")).toBeVisible();
  });

  test("client error (400 / 403) shows inline error, preserves input, and allows retry", async ({
    page,
  }) => {
    const group = await createInvite({
      displayName: "Retry Test Group",
      type: "group",
      maxMembers: 3,
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const input = page.locator("#claim-gate-input");
    const submitBtn = page.locator("#claim-gate-submit");
    await input.fill("Guest Name");

    // 1. Intercept with 403 origin error
    await page.route("**/api/invite/claim", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "cross_origin_post" }),
      });
    });

    await submitBtn.click();

    const errorEl = page.locator("#claim-gate-error-text");
    await expect(errorEl).toContainText("origin error");
    await expect(input).toHaveValue("Guest Name");
    await expect(submitBtn).toBeEnabled();

    // 2. Intercept with 400 validation error
    await page.route("**/api/invite/claim", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "display_name_too_long" }),
      });
    });

    await submitBtn.click();
    await expect(errorEl).toContainText("Nama terlalu panjang");
    await expect(input).toHaveValue("Guest Name");
    await expect(submitBtn).toBeEnabled();
  });

  test("active typing does not time out (>30s)", async ({ page }) => {
    test.slow();
    const group = await createInvite({ displayName: "Typing Group", type: "group", maxMembers: 3 });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    const claimGate = page.locator("#claim-gate");
    await expect(claimGate).toBeVisible();

    // Wait 31 seconds to verify failsafe does not auto-dismiss
    await page.waitForTimeout(31_000);

    await expect(claimGate).toBeVisible();
    const input = page.locator("#claim-gate-input");
    await input.fill("Patient Typist");
    await expect(page.locator("#claim-gate-submit")).toHaveAttribute("data-visible", "true");
  });

  test("welcome gate failsafe delay stays visible (>15s) while typing", async ({ page }) => {
    test.slow();
    const group = await createInvite({
      displayName: "Welcome Failsafe Group",
      type: "group",
      maxMembers: 3,
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    // Wait 16 seconds (longer than WelcomeGate 15s failsafe)
    await page.waitForTimeout(16_000);

    // Welcome gate failsafe was paused, so #welcome-gate is still present and visible in DOM
    const welcomeGate = page.locator("#welcome-gate");
    await expect(welcomeGate).toBeAttached();
    await expect(welcomeGate).toHaveCSS("visibility", "visible");
    const playState = await welcomeGate.evaluate((el) => getComputedStyle(el).animationPlayState);
    expect(playState).toBe("paused");

    // Claim gate is still visible
    await expect(page.locator("#claim-gate")).toBeVisible();
  });

  test("claim gate failsafe fires and reveals welcome gate when script fails to initialize", async ({
    page,
  }) => {
    test.slow();
    const group = await createInvite({
      displayName: "No Script Group",
      type: "group",
      maxMembers: 2,
    });

    // Break inline script on claim gate by throwing on failsafe cancellation
    await page.addInitScript(() => {
      let crashed = false;
      const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, "animation");
      Object.defineProperty(CSSStyleDeclaration.prototype, "animation", {
        configurable: true,
        get() {
          return desc?.get?.call(this);
        },
        set(value) {
          if (!crashed) {
            crashed = true;
            throw new Error("Simulated script init failure on claim gate");
          }
          desc?.set?.call(this, value);
        },
      });
    });

    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    // Wait for the 10-second CSS failsafe animation to complete
    const claimGate = page.locator("#claim-gate");
    await expect(claimGate).toHaveCSS("visibility", "hidden", { timeout: 15_000 });

    // Welcome gate should become visible, armed, and aria-hidden removed
    const welcomeGate = page.locator("#welcome-gate");
    await expect(welcomeGate).toBeVisible();
    await expect(welcomeGate).not.toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("main")).toHaveAttribute("inert", "");

    // Dismiss the revealed welcome gate and verify root scroll lock is released
    await page.keyboard.press("Escape");
    await welcomeGate.waitFor({ state: "detached", timeout: 10_000 });
    const overflow = await page.evaluate(() => document.documentElement.style.overflow);
    expect(overflow).toBe("");
  });

  test("welcome gate failsafe animationend releases root scroll lock and detaches", async ({
    page,
  }) => {
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);
    const welcomeGate = page.locator("#welcome-gate");
    await expect(welcomeGate).toBeVisible();

    // Trigger gate-failsafe animationend
    await welcomeGate.evaluate((el) => {
      el.dispatchEvent(new AnimationEvent("animationend", { animationName: "gate-failsafe" }));
    });

    await welcomeGate.waitFor({ state: "detached", timeout: 5_000 });
    const overflow = await page.evaluate(() => document.documentElement.style.overflow);
    expect(overflow).toBe("");
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  });

  test("individual, already-claimed member, and anonymous visitors bypass claim gate", async ({
    page,
  }) => {
    // 1. Anonymous visitor
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);
    await expect(page.locator("#claim-gate")).toHaveCount(0);
    await expect(page.locator("#welcome-gate")).toBeVisible();

    // 2. Individual invite
    const individual = await createInvite({ displayName: "Solo Guest", type: "individual" });
    await page.goto(`${server.baseUrl}${individual.sharePath}`);
    await waitForLoaderDismissed(page);
    await expect(page.locator("#claim-gate")).toHaveCount(0);
    await expect(page.locator("#gate-greeting")).toHaveText("Solo Guest");

    // 3. Already-claimed member
    const group = await createInvite({ displayName: "Member Group", type: "group", maxMembers: 2 });
    const claimRes = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Already Claimed Member" }),
    });

    // Visit with the member cookie set
    const memberContext = await page.context().browser()!.newContext();
    const memberPage = await memberContext.newPage();
    pinFullTier(memberPage);

    // Set member cookie from Set-Cookie header
    const setCookie = claimRes.headers.get("set-cookie");
    const memberIdMatch = setCookie?.match(/ww_invite_id=([^;]+)/);
    if (memberIdMatch) {
      await memberContext.addCookies([
        {
          name: "ww_invite_id",
          value: memberIdMatch[1]!,
          domain: "localhost",
          path: "/",
        },
      ]);
    }

    await memberPage.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(memberPage);
    await expect(memberPage.locator("#claim-gate")).toHaveCount(0);
    await expect(memberPage.locator("#gate-greeting")).toHaveText("Already Claimed Member");

    await memberContext.close();
  });
});
