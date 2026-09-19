import { expect, test, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";
import { createTestServer } from "./support/server";

// The invite-cookie UI contract (seeded dev server, real gesture): the
// slide-to-confirm celebration arms on the GESTURE, before the RSVP POST
// resolves. A save that fails must roll the control back to fresh — a black
// "confirmed" pill that saved nothing and ignores every retry is a lie with
// no way out but a refresh. The retry that lands confirms for real, and a
// reload renders the server-confirmed state that can no longer be slid.

const INVITE = "RsvpRetry001";

let server: Awaited<ReturnType<typeof createTestServer>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(150_000);
  server = await createTestServer("rsvp-retry");
  const db = await server.connect();
  try {
    await db.execute({
      sql: "INSERT INTO invites (id, display_name, created_at) VALUES (?, ?, 1)",
      args: [INVITE, "Retry Guest"],
    });
  } finally {
    db.close();
  }
});

test.afterAll(async () => {
  await server?.dispose();
});

async function openRsvp(page: Page) {
  await page
    .context()
    .addCookies([{ name: "ww_invite_id", value: INVITE, domain: "localhost", path: "/" }]);
  await page.goto(server.baseUrl + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissWelcomeGate(page);
  const btn = page.locator("[data-rsvp-confirm]");
  await expect(btn).toBeVisible();
  await btn.scrollIntoViewIfNeeded();
  // The entrance's 500ms clip-path expansion must finish first: while it
  // runs, the still-collapsed left edge is not hit-testable.
  await page.waitForFunction(
    () => {
      const b = document.querySelector("[data-rsvp-confirm]");
      if (!b) return false;
      if (
        b.hasAttribute("data-slide-entrance") &&
        b.getAttribute("data-slide-entrance") !== "revealing"
      )
        return false;
      if (getComputedStyle(b).opacity !== "1") return false;
      return b.getAnimations({ subtree: true }).every((a) => a.playState === "finished");
    },
    undefined,
    { timeout: 15_000 },
  );
  return btn;
}

/** A full slide gesture, from the handle's logical home to the far end. */
async function slide(page: Page, btn: ReturnType<Page["locator"]>) {
  const handle = btn.locator("[data-slide-to-confirm-handle]");
  const box = (await btn.boundingBox())!;
  const hbox = (await handle.boundingBox())!;
  const y = hbox.y + hbox.height / 2;
  await page.mouse.move(box.x + 4 + hbox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - hbox.width / 2 - 4, y, { steps: 30 });
  await page.mouse.up();
}

const pillState = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector("[data-rsvp-confirm]") as HTMLButtonElement;
    const label = b.querySelector<HTMLElement>("[data-slide-to-confirm-text]")!;
    const handle = b.querySelector<HTMLElement>("[data-slide-to-confirm-handle]")!;
    return {
      disabled: b.disabled,
      confirmedClass: b.classList.contains("slide-to-confirm--confirmed"),
      label: label.textContent,
      handleX: handle.style.getPropertyValue("--slide-to-confirm-x"),
      fillR: b.style.getPropertyValue("--slide-to-confirm-fill-r"),
    };
  });

test("a failed save rolls the pill back; the retry that lands sticks across a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const btn = await openRsvp(page);
  await expect(btn).toHaveText(/Confirm Reservation/);

  // --- First slide: the RSVP POST fails like a storage outage (503). ---
  await page.route("**/api/rsvp", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "" });
    } else {
      await route.fallback();
    }
  });
  await slide(page, btn);
  await expect(page.locator("[data-rsvp-error]")).toContainText(/couldn't save your rsvp/i);
  await page.waitForTimeout(2000); // let any late celebration beats land if uncancelled

  // The presentation is rolled back: fresh class, fill unpainted, handle
  // sprung home, label never swapped, control pressable again.
  await expect.poll(async () => (await pillState(page)).handleX).toBe("0px");
  const rolledBack = await pillState(page);
  expect(rolledBack.confirmedClass).toBe(false);
  expect(rolledBack.fillR).toBe("0px");
  expect(rolledBack.label).toMatch(/Confirm Reservation/);
  expect(rolledBack.disabled).toBe(false);

  // --- Second slide: the save lands. ---
  await page.unroute("**/api/rsvp");
  await slide(page, btn);
  await expect(btn).toHaveText(/Reservation Confirmed/);
  await expect(btn).toBeDisabled();
  const confirmed = await pillState(page);
  expect(confirmed.confirmedClass).toBe(true);
  await expect
    .poll(async () => {
      const res = await page.evaluate(() =>
        fetch("/api/rsvp", { cache: "no-store" }).then((r) => r.json()),
      );
      return res.attending;
    })
    .toBe(true);

  // --- Reload: the server-rendered state is confirmed and inert. ---
  await page.goto(server.baseUrl + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissWelcomeGate(page);
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toHaveText(/Reservation Confirmed/);
  await expect(btn).toBeDisabled();

  // A returning guest's full slide does nothing: pointerdown is barred by
  // the disabled control and no submit is dispatched.
  const submits: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/rsvp")
      submits.push(req.url());
  });
  await slide(page, btn);
  await page.waitForTimeout(1000);
  expect(submits).toHaveLength(0);
  const after = await pillState(page);
  expect(after.confirmedClass).toBe(true);
  expect(after.disabled).toBe(true);
  expect(after.label).toMatch(/Reservation Confirmed/);
});
