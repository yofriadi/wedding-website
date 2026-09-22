import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { guestPhotos } from "@wedding-website/db/schema";
import { desc, eq, or } from "drizzle-orm";
import { enqueueAvifVariant } from "../../../lib/avif-queue";
import { publishGuestPhoto } from "../../../lib/guest-photo-upload";
import type { GuestPhotosPayload } from "../../../lib/guest-photos";
import { canonicalizePhoto } from "../../../lib/image-encode";
import { notFound, resolveInvite, serviceUnavailable } from "../../../lib/invite-session";
import { crossOriginPostForbidden, isSameOriginRequest } from "../../../lib/same-origin";
import {
  detectPhotoType,
  MAX_PHOTO_BYTES,
  reservePhotoDirectory,
} from "../../../lib/photo-storage";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "error") return serviceUnavailable();
  const inviteId = resolution.status === "ok" ? resolution.invite.id : null;
  try {
    const rows = await db
      .select()
      .from(guestPhotos)
      .orderBy(desc(guestPhotos.createdAt), desc(guestPhotos.id));
    const payload: GuestPhotosPayload = {
      inviteValid: inviteId !== null,
      mineId: rows.find((row) => row.inviteId === inviteId)?.id ?? null,
      photos: rows.map((row) => ({
        id: row.id,
        photoUrl: `/api/photos/${row.key}`,
        createdAt: row.createdAt,
      })),
    };
    return json(200, payload);
  } catch (error) {
    console.error("[guest-photos] collection read failed:", error);
    return serviceUnavailable();
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  // Resolve identity before parsing even an invalid/large request body.
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") return notFound();
  if (resolution.status === "error") return serviceUnavailable();

  // THE origin check for this endpoint — Astro's framework `checkOrigin` is
  // disabled repo-wide (see lib/same-origin.ts), so nothing else inspects this
  // request. Proxy-aware: behind the documented Caddy/HTTPS deployment
  // `request.url` is `http://<host>` while the browser's Origin is `https://<host>`,
  // and a naive comparison would 403 every legitimate upload. Placed BEFORE the
  // authorization branch below, so a cross-origin caller learns nothing about
  // group state, and before ANY multipart or storage handling, so nothing is
  // persisted or even reserved for a refused request.
  if (!isSameOriginRequest(request)) return crossOriginPostForbidden();

  // A group cookie is a VALID but UNCLAIMED identity: reject before any multipart
  // or storage handling so nothing is persisted or even reserved for it
  // (guest-photos spec). Claimed members pass through exactly as standalone
  // individuals do — each holds its own single photo slot.
  if (resolution.invite.kind === "group") return json(409, { error: "claim_required" });

  if (!/^multipart\/form-data(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json(400, { error: "invalid_body" });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "invalid_body" });
  }
  if (Array.from(form.keys()).some((key) => key !== "photo"))
    return json(400, { error: "invalid_body" });
  const files = form.getAll("photo");
  if (files.length === 0) return json(400, { error: "empty_photo" });
  if (files.length > 1) return json(400, { error: "too_many_photos" });
  const file = files[0];
  if (!file || typeof file === "string") return json(400, { error: "invalid_body" });
  if (file.size > MAX_PHOTO_BYTES) return json(400, { error: "photo_too_large" });

  let canonical: Uint8Array;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectPhotoType(bytes);
    if (!type) return json(400, { error: "invalid_photo_type" });
    canonical = (await canonicalizePhoto(bytes, type)).bytes;
  } catch {
    return json(400, { error: "invalid_photo_type" });
  }

  const result = await publishGuestPhoto(resolution.invite.id, canonical, {
    reserve: reservePhotoDirectory,
    async insert(row) {
      await db.insert(guestPhotos).values(row);
    },
    async findAttempt(id, key) {
      const rows = await db
        .select()
        .from(guestPhotos)
        .where(or(eq(guestPhotos.id, id), eq(guestPhotos.key, key)))
        .limit(1);
      return rows[0] ?? null;
    },
    enqueue: enqueueAvifVariant,
    log: (message, error) => console.error(`[guest-photos] ${message}:`, error),
  });
  if (result.status === "accepted") return json(201, result.photo);
  if (result.status === "duplicate") return json(409, { error: "already_posted" });
  return serviceUnavailable();
};
