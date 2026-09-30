import { expect, test } from "@playwright/test";
import { createTestServer } from "./support/server";
import { TEST_ADMIN_TOKEN } from "./support/database";
import { pinFullTier, waitForLoaderDismissed } from "./helpers";

let server: Awaited<ReturnType<typeof createTestServer>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(150_000);
  server = await createTestServer("desktop-gate-tests");
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

test.describe("desktop gate", () => {
  test("DesktopGate is visible on 1280x720 and data-qr-target matches expected URL", async ({
    page,
  }) => {
    pinFullTier(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);

    const gate = page.locator("#desktop-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("role", "dialog");
    await expect(gate).toHaveAttribute("aria-modal", "true");
    await expect(gate).toHaveAttribute("data-qr-target", `${server.baseUrl}/`);
  });

  test("DesktopGate encodes ${origin}/${inviteId} when invite cookie is present", async ({
    page,
    context,
  }) => {
    pinFullTier(page);
    const invite = await createInvite({ displayName: "Desktop Guest", type: "individual" });

    await context.addCookies([
      {
        name: "ww_invite_id",
        value: invite.id,
        url: server.baseUrl,
      },
    ]);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);

    const gate = page.locator("#desktop-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("data-qr-target", `${server.baseUrl}/${invite.id}`);
  });

  test("DesktopGate is hidden on mobile portrait (412x915) and mobile landscape (915x412)", async ({
    page,
  }) => {
    pinFullTier(page);

    // Mobile portrait: 412x915
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);
    await expect(page.locator("#desktop-gate")).toBeHidden();

    // Mobile landscape: 915x412 (height < 600px)
    await page.setViewportSize({ width: 915, height: 412 });
    await expect(page.locator("#desktop-gate")).toBeHidden();
  });

  test("accessibility containment: inert on desktop, handoff on mobile resize", async ({
    page,
  }) => {
    pinFullTier(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);

    const gate = page.locator("#desktop-gate");
    await expect(gate).toBeVisible();

    const main = page.locator("main");
    const welcomeGate = page.locator("#welcome-gate");

    // Inert containment while gate is displayed
    await expect(main).toHaveAttribute("inert", "");
    await expect(welcomeGate).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

    // Resize below threshold: handoff to welcome gate
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(gate).toBeHidden();

    // Welcome gate loses inert
    await expect(welcomeGate).not.toHaveAttribute("inert", "");
    // Main retains inert until welcome gate exit
    await expect(main).toHaveAttribute("inert", "");

    // Dismiss welcome gate
    await page.keyboard.press("Escape");
    await welcomeGate.waitFor({ state: "detached", timeout: 10_000 });

    // After welcome gate dismissal, main loses inert and root scroll unlocks
    await expect(main).not.toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });

  test("background media suppression on desktop: no mp3 requests and collage unpromoted", async ({
    page,
  }) => {
    pinFullTier(page);
    const audioRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(".mp3")) {
        audioRequests.push(req.url());
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/`);
    await waitForLoaderDismissed(page);

    // Wait past the normal soundtrack preloading window (1200ms)
    await page.waitForTimeout(2000);

    // No .mp3 requests should be initiated
    expect(audioRequests).toHaveLength(0);

    // Collage deferred images remain unpromoted: none carry data-promoted attribute
    const promotedImages = page.locator("#zoom-parallax-container img[data-promoted]");
    await expect(promotedImages).toHaveCount(0);

    const collageImages = page.locator("#zoom-parallax-container img[data-src]");
    const count = await collageImages.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const src = await collageImages.nth(i).getAttribute("src");
      expect(src).toMatch(/-lqip\.webp/);
    }
  });
});
