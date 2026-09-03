import { env } from "@wedding-website/env/server";
import { encodeAvifVariant } from "./image-encode";
import { avifVariantKey, photoExists, readPhoto, writePhotoAtKey } from "./photo-storage";

// AVIF variant queue (photo-normalization): AVIF is ~35% smaller than the
// canonical WebP but ~4× slower to encode, so it is deliberately NOT part of
// the upload request — the guest gets their 201 after the cheap WebP encode,
// and this queue writes `submissions/<id>/<position>.avif` afterwards. The
// photo route serves the variant when it exists and the browser asked for it,
// so the same URL quietly upgrades a few seconds after posting.
//
// In-process by design: one Node process, ~100 guests, no worker infrastructure
// worth its weight. Concurrency is 1 so a burst of uploads can never put
// several multi-second AVIF encodes on the same small VM at once.

// Bounded on purpose. A full queue DROPS the job rather than growing without
// limit, which is safe because the photo route re-enqueues on the next
// AVIF-capable request for that key (self-healing below) — a dropped variant
// costs one WebP serve, not a broken image.
const MAX_QUEUE_DEPTH = 64;

const queue: string[] = [];
/** Keys queued or in flight — dedupes the enqueue sites (upload + GET). */
const pending = new Set<string>();
/** Keys whose encode threw: not retried for the life of the process. */
const failed = new Set<string>();
let draining = false;

/**
 * Request an AVIF variant for a canonical key. Fire-and-forget: never throws,
 * never awaits, safe to call from a route that is about to respond.
 */
export function enqueueAvifVariant(key: string): void {
  if (!env.PHOTO_AVIF_ENABLED) return;
  if (avifVariantKey(key) === null) return; // already AVIF, or not a photo key
  if (pending.has(key) || failed.has(key)) return;
  if (queue.length >= MAX_QUEUE_DEPTH) {
    // Dropping is safe (the photo route re-enqueues on the next AVIF-capable
    // request), but it is the one signal that the host cannot keep up with
    // variant generation — and ops/README.md's story is "watch the journal", so
    // it has to actually appear there.
    console.warn(
      `[avif-queue] depth cap ${MAX_QUEUE_DEPTH} reached, dropping variant job: ${key}` +
        " (the photo route re-enqueues it on the next AVIF-capable request)",
    );
    return;
  }
  queue.push(key);
  pending.add(key);
  void drain().catch((err) => {
    // drain() catches per item; this is the last-resort guard against an
    // unhandled rejection taking the process down.
    console.error("[avif-queue] drain failed:", err);
  });
}

async function drain(): Promise<void> {
  if (draining) return; // one worker: the loop below owns the queue
  draining = true;
  try {
    let key = queue.shift();
    while (key !== undefined) {
      pending.delete(key);
      try {
        await encodeOne(key);
      } catch (err) {
        failed.add(key);
        // Not fatal: the canonical WebP still serves. A variant that cannot be
        // built (corrupt canonical, encoder failure) just never exists.
        console.error("[avif-queue] variant failed:", key, err);
      }
      key = queue.shift();
    }
  } finally {
    draining = false;
  }
}

async function encodeOne(key: string): Promise<void> {
  const variant = avifVariantKey(key);
  if (variant === null) return;
  if (await photoExists(variant)) return; // raced, or a repeat enqueue
  const canonical = await readPhoto(key);
  if (canonical === null) return; // submission removed (moderation) mid-queue
  const avif = await encodeAvifVariant(canonical.bytes);
  await writePhotoAtKey(variant, avif);
}
