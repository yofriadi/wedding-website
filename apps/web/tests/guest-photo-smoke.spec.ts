import { expect, test } from "@playwright/test";
import sharp from "sharp";
import type { GuestPhotosPayload } from "../src/lib/guest-photos";
import { createTestServer } from "./support/server";
import { TEST_ADMIN_TOKEN } from "./support/database";
import { dismissWelcomeGate } from "./helpers";

test("fresh invite can RSVP and upload once, then remain publicly visible after reload", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const server = await createTestServer("guest-photo-smoke");
  try {
    const initial = await fetch(`${server.baseUrl}/api/guest-photos`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(await initial.json()).toEqual({ inviteValid: false, mineId: null, photos: [] });
    const created = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { origin: server.baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Smoke & Guest" }),
    });
    expect(created.status).toBe(201);
    const invitation = (await created.json()) as { id: string; sharePath: string };
    expect(invitation.sharePath).toBe(`/${invitation.id}`);
    await page.goto(`${server.baseUrl}${invitation.sharePath}`);
    await dismissWelcomeGate(page);
    const rsvp = await page.request.post(`${server.baseUrl}/api/rsvp`, {
      headers: { origin: server.baseUrl },
      data: { attending: true },
      timeout: 10_000,
    });
    expect(rsvp.status()).toBe(200);
    expect(await (await page.request.get(`${server.baseUrl}/api/rsvp/count`)).json()).toEqual({
      count: 1,
    });
    const controls = page.locator("photo-trail-controls");
    const button = page.locator("[data-add-image]");
    await controls.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await expect(controls).toHaveAttribute("data-revealed", "");
    const picker = page.waitForEvent("filechooser");
    await button.click();
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/guest-photos") && response.request().method() === "POST",
    );
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#a87963" },
    })
      .png()
      .toBuffer();
    await (await picker).setFiles({ name: "memory.png", mimeType: "image/png", buffer: bytes });
    const response = await accepted;
    expect(response.status()).toBe(201);
    await expect(button).toHaveAccessibleName("Foto ditambahkan");
    const publicCollection = await fetch(`${server.baseUrl}/api/guest-photos`, {
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await publicCollection.json()) as GuestPhotosPayload;
    expect(payload.inviteValid).toBe(false);
    expect(payload.mineId).toBeNull();
    expect(payload.photos).toHaveLength(1);
    const photo = payload.photos[0]!;
    expect(await page.locator("[data-trail-images]").textContent()).toContain(photo.photoUrl);
    expect(
      (await fetch(`${server.baseUrl}${photo.photoUrl}`, { signal: AbortSignal.timeout(10_000) }))
        .status,
    ).toBe(200);
    const duplicate = await page.request.post(`${server.baseUrl}/api/guest-photos`, {
      headers: { origin: server.baseUrl },
      multipart: { photo: { name: "again.png", mimeType: "image/png", buffer: bytes } },
      timeout: 10_000,
    });
    expect(duplicate.status()).toBe(409);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await dismissWelcomeGate(page);
    await controls.scrollIntoViewIfNeeded();
    await expect(button).toHaveAccessibleName("Foto ditambahkan");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      (await fetch(`${server.baseUrl}/api/submissions`, { signal: AbortSignal.timeout(10_000) }))
        .status,
    ).toBe(404);
    await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10_000 });
  } finally {
    await server.dispose();
  }
});
