# Tasks: photo-normalization

**Superseded contracts:** `guest-photo-clean-baseline` retains normalization/AVIF safety but replaces the collection, schema, file paths, and thumbnail requirements. Do not synchronize this older change's spec delta onto the new baseline. Preserve this implementation history; close it with spec synchronization skipped once the pending deployment checks are accounted for. See `../guest-photo-clean-baseline/handoff.md`.

## 1. Encode pipeline

- [x] 1.1 `lib/image-encode.ts`: `MAX_PHOTO_EDGE` (2048), WebP q80/e4 canonical (`.rotate()` → `resize inside` → `webp`), AVIF q55/e4 variant, 224×400 thumbnail, `probeImage`, `canonicalizePhoto` with the pass-through rule (already-modern, in-cap, oriented, metadata-free, not larger)
- [x] 1.2 `limitInputPixels: 64_000_000` on every input (replaces sharp's 268MP default; still admits a real 48MP capture) and `failOn: "none"` to keep tolerant decodes tolerant
- [x] 1.3 Document the measured encode costs and why AVIF is not in the request path

## 2. Storage

- [x] 2.1 `photo-storage.ts`: extend `KEY_RE` to `thumb.(?:webp|avif)` (position keys already allowed `.avif`)
- [x] 2.2 `avifVariantKey(key)` → sibling key or null (invalid key, or already avif)
- [x] 2.3 `photoExists(key)` (stat + `isFile()`) and `writePhotoAtKey(key, bytes)` for variants
- [x] 2.4 `contentTypeForKey(key)` so the route reports the type of what it actually served

## 3. Background AVIF

- [x] 3.1 `lib/avif-queue.ts`: FIFO, concurrency 1, `pending` dedupe, `failed` no-retry, depth cap 64 that drops rather than grows
- [x] 3.2 `enqueueAvifVariant(key)` is fire-and-forget, never throws, respects `PHOTO_AVIF_ENABLED`
- [x] 3.3 `packages/env/src/server.ts`: `PHOTO_AVIF_ENABLED` as an enum+transform (NOT `z.coerce.boolean()`, which maps the string `"false"` to `true`)
- [x] 3.4 `apps/web/.env.example`: document the switch

## 4. Routes

- [x] 4.1 `api/submissions`: normalize inside `parseMultipart` (pre-claim), so a corrupt payload is a 400 with nothing written and nothing to clean up
- [x] 4.2 `api/submissions`: thumbnail from the canonical bytes; enqueue variants for every stored key + the thumb just before the 201; update the order-of-operations comment
- [x] 4.3 `api/photos/[...key]`: serve the AVIF variant only when `Accept` explicitly lists `image/avif` with non-zero q (`*/*` does not qualify)
- [x] 4.4 `api/photos/[...key]`: re-enqueue on a missing variant (self-heal: restart, dropped job, pre-existing rows); add `Vary: Accept` to successes; keep 404s `no-store` and `immutable` caching unchanged
- [x] 4.5 Route header documents the Cloudflare free-plan `Vary` trap

## 5. Tests

- [x] 5.1 `tests/photo-pipeline.spec.ts`: own server + throwaway DB + throwaway `PHOTO_STORAGE_DIR` (mock-gate-ssr pattern), leak-proof teardown, chromium-only
- [x] 5.2 Upload test: 3000×2000 JPEG + 1000×700 PNG in one submission → both stored as `.webp`, capped to 2048×1365 / kept at 1000×700 (no upscale), both smaller than what arrived, thumb is 224×400 WebP
- [x] 5.3 EXIF test: a JPEG carrying camera EXIF (incl. a GPS IFD) stores with `exif`/`xmp`/`iptc` all undefined
- [x] 5.4 Negotiation test: same URL serves WebP → then AVIF once the queue lands; `Vary: Accept` + `immutable` on both; a no-AVIF `Accept` and a `*/*` `Accept` keep getting WebP _after_ the variant exists; all six files on disk; canonical bytes untouched
- [x] 5.5 Rejection test: undecodable bytes → 400 `invalid_photo_type`, no submission row, no directory
- [x] 5.6 Fixtures are photo-like (attenuated noise via `linear`, since `OverlayOptions` has no `opacity`) so size assertions cannot pass on a flat fill; POST sends `Origin` because Astro's `checkOrigin` is on by default
- [x] 5.7 Pass-through test (added on plan review — the rule is the one branch that returns the guest's bytes verbatim, so a regression there is silent): three fixtures in one submission isolating each blocking conjunct — an optimal WebP stored byte-identical, the same WebP + EXIF re-encoded, and an over-cap WebP that is SMALLER than its re-encode still resized to 2048×1365
- [x] 5.8 `pnpm check-types` clean; full Playwright suite green

## 6. Close-out

- [x] 6.1 `ops/README.md`: storage layout mentions the `.avif` siblings and the edge-cache/`Vary` constraint
- [ ] 6.2 Transferred to the `guest-photo-clean-baseline` release handoff: after an authorized production deployment, verify `PHOTO_AVIF_ENABLED` and a real `PHOTO_STORAGE_DIR/guest-photos/<photo-id>/photo.webp` / `photo.avif` pair. Still pending; isolated fixture tests do not verify production.
- [ ] 6.3 If a Cloudflare cache rule is ever added for `/api/photos/*`, re-read D6 first (free plan ignores `Vary: Accept` for images)

## 7. Review-driven fixes (plan-reviewer + code-reviewer)

- [x] 7.1 **MEDIUM** — atomic photo writes: one `writeFileAtomic` helper (`<file>.part` in the same directory, then `rename()`; temp removed on failure) used by `writePhoto`, `writeThumbnail` and `writePhotoAtKey`. Without it a concurrent AVIF-capable GET could read a half-written variant and serve it under `immutable, max-age=31536000` — a millisecond race cached for a year
- [x] 7.2 Knock-on ops fixes for the temp files: `backup.sh` uses `rsync -a --exclude='*.part'` (was `cp -R`), `restore-drill.sh` excludes `*.part` from BOTH checksum trees, and the pipeline test's exact directory listing fails on a leftover temp
- [x] 7.3 **LOW** — pass-through is now WebP-only, so "a browser that cannot decode AVIF is never sent one" is true instead of approximately true: an AVIF upload becomes a WebP canonical + queued variant (D7 carries the measured cost and the deferred fallback-direction alternative with its trigger)
- [x] 7.4 **LOW** — queue drop at the depth cap now logs (was silent, while ops' story for this queue is "watch the journal")
- [x] 7.5 **NIT** — dropped the redundant `photoExists` stat before `readPhoto` in the route (one wasted syscall per AVIF-capable GET, and it widened the write race); removed the dead `avifQueueStats` export; `PHOTO_AVIF_ENABLED` lowercases before the enum so `TRUE` works while a typo still fails loud; `ops/README.md` layout diagram re-aligned
- [x] 7.6 New test: an AVIF upload stores a WebP canonical at `0.webp` (not `0.avif`) and still gains an AVIF variant on the same URL
- [x] 7.7 Deliberately NOT changed: pre-existing dead code adjacent to this diff (`readPhoto`'s fabricated `stat.mtime`, unused `photoContentType` / `THUMBNAIL_CONTENT_TYPE` / `StoredPhoto` / `PHOTO_POSITION_*`) — out of scope for a photo-format change; noted for a cleanup pass
- [x] 7.8 `pnpm check-types` clean; `photo-pipeline` 6/6; full Playwright suite green
