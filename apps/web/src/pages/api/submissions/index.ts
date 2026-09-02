import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites, submissionPhotos, submissions } from "@wedding-website/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { enqueueAvifVariant } from "../../../lib/avif-queue";
import { canonicalizePhoto, encodeThumbnail } from "../../../lib/image-encode";
import {
  MAX_PHOTOS_PER_SUBMISSION,
  MAX_PHOTO_BYTES,
  detectPhotoType,
  photoExt,
  removeSubmissionDir,
  thumbnailKey,
  writePhoto,
  writeThumbnail,
  type PhotoType,
} from "../../../lib/photo-storage";
import { notFound, resolveInvite, serviceUnavailable } from "../../../lib/invite-session";
import { generateSubmissionId, normalizeWishText } from "../../../lib/submissions";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Detect a UNIQUE violation on the invite_id constraint specifically — not
// "any UNIQUE error". A submissions.id pk collision is also a UNIQUE
// violation but must NOT report as already_posted (it is a retryable
// server-side id issue, not "you already posted"). Empirically (drizzle +
// libsql 0.17): drizzle wraps the LibsqlError as `cause`; the LibsqlError
// carries code "SQLITE_CONSTRAINT" and a message naming the exact failed
// constraint, e.g. "UNIQUE constraint failed: submissions.invite_id" vs
// "...submissions.id" for the pk. Matching the constraint identifier (not the
// bare word UNIQUE) is what makes the two cases distinguishable.
function isInviteIdUniqueViolation(err: unknown): boolean {
  const candidates = [err, (err as { cause?: unknown })?.cause];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const { code, message } = candidate as { code?: unknown; message?: unknown };
    if (code !== "SQLITE_CONSTRAINT" && code !== "SQLITE_CONSTRAINT_UNIQUE") {
      continue;
    }
    if (typeof message === "string" && message.includes("submissions.invite_id")) {
      return true;
    }
  }
  return false;
}

// Read side for the wall: every caller gets `wall` — the caller's own
// submission (`mine`, cookie holders only) plus everyone else's, EXCLUDING
// the caller's own row (dedupe by id) so their own wish/photos never render
// twice — the caller's content is surfaced via `mine` only.
// Attribution (story-rail-attribution D3): STORY entries carry the poster's
// first name, derived at read time from their invite's display_name — no
// snapshot column, so an admin rename propagates to the wall. Wishes stay
// name-free (guest-wishes); the old payload-wide no-names rule (D1a) is
// retired for stories only.
// Anonymous callers (public-wall D1) receive `mine: null` + the same wall;
// posting below stays cookie-gated. `inviteValid` distinguishes a resolved
// invite (true) from an anonymous caller or a STALE well-shaped cookie
// (false) — the client gates the add-story tile on it, since a stale
// cookie must not keep a dead posting affordance visible.
// `wall.stories` lists submissions newest-first, photos per submission
// ordered by position; positions themselves are not exposed on the wall.

// story-rail-attribution D3: the poster's public first name is the FIRST
// whitespace-separated token of their invite's display_name ("Yofriadi Yahya
// & Partner" → "Yofriadi"). An empty derivation (whitespace-only name, or a
// join that found no invite row) yields null — the tile then renders the
// attribution-free layout instead of an empty label.
function deriveFirstName(displayName: string | null | undefined): string | null {
  const token = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return token.length > 0 ? token : null;
}

export const GET: APIRoute = async ({ cookies }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "error") {
    return serviceUnavailable();
  }
  // public-wall D1: `not_found` means anonymous here, not reject — the wall
  // is a public read API, so anonymous callers get `{ mine: null, wall }`
  // (200). `resolveInvite`'s uniform-404 meaning is unchanged for every
  // OTHER consumer (invite/me, RSVP); `mine` requires a resolved invite by
  // construction.
  const invite = resolution.status === "ok" ? resolution.invite : null;
  try {
    const submissionRows = await db
      .select({
        id: submissions.id,
        inviteId: submissions.inviteId,
        wishText: submissions.wishText,
        createdAt: submissions.createdAt,
        displayName: invites.displayName,
      })
      .from(submissions)
      .leftJoin(invites, eq(invites.id, submissions.inviteId))
      .orderBy(desc(submissions.createdAt), desc(submissions.id));

    const photoRows = await db
      .select({
        submissionId: submissionPhotos.submissionId,
        key: submissionPhotos.key,
      })
      .from(submissionPhotos)
      .orderBy(asc(submissionPhotos.submissionId), asc(submissionPhotos.position));

    const photosBySubmission = new Map<string, { photoUrl: string; thumbnailUrl: string }[]>();
    for (const row of photoRows) {
      const list = photosBySubmission.get(row.submissionId) ?? [];
      list.push({
        photoUrl: `/api/photos/${row.key}`,
        // Rail-sized cover (L6): tiles render this, never a 10MB original.
        thumbnailUrl: `/api/photos/${thumbnailKey(row.submissionId)}`,
      });
      photosBySubmission.set(row.submissionId, list);
    }

    let mine: {
      id: string;
      wishText: string | null;
      photos: { photoUrl: string; thumbnailUrl: string }[];
      firstName: string | null;
      createdAt: number;
    } | null = null;
    const wallWishes: { text: string }[] = [];
    const wallStories: {
      photos: { photoUrl: string; thumbnailUrl: string }[];
      firstName: string | null;
      createdAt: number;
    }[] = [];

    for (const row of submissionRows) {
      const photos = photosBySubmission.get(row.id) ?? [];
      const firstName = deriveFirstName(row.displayName);
      if (invite !== null && row.inviteId === invite.id) {
        mine = {
          id: row.id,
          wishText: row.wishText ?? null,
          photos,
          firstName,
          createdAt: row.createdAt,
        };
        continue;
      }
      if (row.wishText !== null) {
        wallWishes.push({ text: row.wishText });
      }
      if (photos.length > 0) {
        wallStories.push({ photos, firstName, createdAt: row.createdAt });
      }
    }

    return json(200, {
      mine,
      inviteValid: invite !== null,
      wall: { wishes: wallWishes, stories: wallStories },
    });
  } catch (err) {
    console.error("[submissions] read failed:", err);
    return serviceUnavailable();
  }
};

// One accepted photo, already NORMALIZED: `bytes` is what gets written to disk
// and `type` is its canonical format (normally "webp"; image-encode.ts keeps an
// already-optimal WebP/AVIF upload as-is rather than making it bigger). The
// upload's own detected type is deliberately NOT carried forward — nothing
// downstream may assume the stored file is what the guest sent.
interface ValidatedPhoto {
  type: PhotoType;
  bytes: Buffer;
}

// Multipart parsing + validation. Everything is validated BEFORE any write
// (row or file): a mid-batch failure must not leave partial state behind.
async function parseMultipart(
  formData: FormData,
): Promise<
  { ok: true; wishText: string | null; photos: ValidatedPhoto[] } | { ok: false; error: string }
> {
  const wishRaw = formData.get("wishText");
  const wishResult = normalizeWishText(wishRaw);
  if (!wishResult.ok) {
    return { ok: false, error: "invalid_wish_text" };
  }
  const wishText = wishResult.value;

  const photoEntries = formData.getAll("photos").filter((v): v is File => v instanceof File);
  if (photoEntries.length > MAX_PHOTOS_PER_SUBMISSION) {
    return { ok: false, error: "too_many_photos" };
  }

  const photos: ValidatedPhoto[] = [];
  for (const file of photoEntries) {
    if (file.size > MAX_PHOTO_BYTES) {
      return { ok: false, error: "photo_too_large" };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectPhotoType(bytes);
    if (!type) {
      // Content is king: Content-Type/filename extensions are never trusted.
      return { ok: false, error: "invalid_photo_type" };
    }
    // Normalize BEFORE any write (row or file): the canonical encode is part of
    // validation, so bytes whose magic is right but whose payload is truncated
    // or corrupt fail here — nothing claimed, nothing to clean up. This is also
    // where the ~0.5s/photo WebP encode is spent. AVIF is NOT encoded here; it
    // is queued after the 201 (lib/avif-queue.ts) so it can never make a guest
    // wait.
    try {
      const canonical = await canonicalizePhoto(bytes, type);
      photos.push({ type: canonical.type, bytes: canonical.bytes });
    } catch (err) {
      console.error("[submissions] photo normalization failed:", err);
      return { ok: false, error: "invalid_photo_type" };
    }
  }

  // At-least-one-content rule (blank text counts as no text).
  if (wishText === null && photos.length === 0) {
    return { ok: false, error: "empty_submission" };
  }

  return { ok: true, wishText, photos };
}

// Create the caller's single submission (wish text + optional photos).
// AUTHENTICATE FIRST: the cookie is resolved before the body is read, so
// anonymous callers get the uniform 404 even with a garbage body
// (endpoint-invisibility rule).
//
// Order of operations (guest-photos spec, "Upload failure is atomic-ish"):
//   1. validate everything (size/magic/count) AND normalize each photo to its
//      canonical file — no writes yet, so a failure here needs no cleanup
//   2. claim the submission row (UNIQUE invite_id wins the post-once race)
//   3. write files + photo rows + thumbnail
//   4. on ANY failure after the claim: delete the row AND the whole dir
//   5. AFTER the 201: queue AVIF variants (background; never blocks a guest)
// Otherwise a mid-batch failure leaves a claimed row that permanently locks
// the guest out (UNIQUE + no edit/delete path).
export const POST: APIRoute = async ({ cookies, request }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") {
    return notFound();
  }
  if (resolution.status === "error") {
    return serviceUnavailable();
  }
  const { invite } = resolution;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json(400, { error: "invalid_body" });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json(400, { error: "invalid_body" });
  }

  const parsed = await parseMultipart(formData);
  if (!parsed.ok) {
    return json(400, { error: parsed.error });
  }
  const { wishText, photos } = parsed;

  const id = generateSubmissionId();

  // Claim the row FIRST. A UNIQUE(invite_id) loss here is the 409 — the guest
  // already posted; no files were touched.
  try {
    await db.insert(submissions).values({
      id,
      inviteId: invite.id,
      wishText,
      createdAt: Date.now(),
    });
  } catch (err) {
    if (isInviteIdUniqueViolation(err)) {
      return json(409, { error: "already_posted" });
    }
    console.error("[submissions] insert failed:", err);
    return serviceUnavailable();
  }

  // Everything below runs on a claimed row: every failure path cleans up BOTH
  // the row and the generated directory before responding non-201.
  async function cleanup() {
    try {
      await db.delete(submissionPhotos).where(eq(submissionPhotos.submissionId, id));
      await db
        .delete(submissions)
        .where(and(eq(submissions.id, id), eq(submissions.inviteId, invite.id)));
      await removeSubmissionDir(id);
    } catch (cleanupErr) {
      console.error("[submissions] cleanup failed:", cleanupErr);
    }
  }

  try {
    const storedKeys: string[] = [];
    for (let position = 0; position < photos.length; position++) {
      const photo = photos[position];
      if (!photo) {
        continue;
      }
      const key = await writePhoto(id, position, photo.type, photo.bytes);
      storedKeys.push(key);
      await db.insert(submissionPhotos).values({
        id: generateSubmissionId(),
        submissionId: id,
        key,
        position,
        createdAt: Date.now(),
      });
    }

    // One small thumbnail per submission (L6): the rail serves this, never a
    // full original. Made from the first photo's canonical bytes — already
    // rotated and capped, so this is a cheap downscale. Failure is fatal
    // (cleanup): the rail must never fall back to an original.
    if (photos.length > 0) {
      const first = photos[0];
      if (!first) {
        throw new Error("first photo missing");
      }
      const thumb = await encodeThumbnail(first.bytes);
      await writeThumbnail(id, new Uint8Array(thumb));
      storedKeys.push(thumbnailKey(id));
    }

    // Queue AVIF variants instead of awaiting them: the guest gets the 201 now,
    // the ~35%-smaller siblings land seconds later, and the photo route's Accept
    // negotiation serves them from the SAME urls returned below. Fire-and-forget
    // by contract — enqueueAvifVariant cannot throw, so a variant failure can
    // never turn a successful post into a 503.
    for (const key of storedKeys) {
      enqueueAvifVariant(key);
    }

    const photoEntries = photos.map((photo, position) => ({
      photoUrl: `/api/photos/submissions/${id}/${position}.${photoExt(photo.type)}`,
      thumbnailUrl: `/api/photos/${thumbnailKey(id)}`,
    }));

    return json(201, { id, wishText, photos: photoEntries });
  } catch (err) {
    console.error("[submissions] photo pipeline failed:", err);
    await cleanup();
    return serviceUnavailable();
  }
};
