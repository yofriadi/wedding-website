# Proposal: Photo normalization (canonical WebP + out-of-band AVIF)

## Why

Guest uploads are stored **verbatim**. `POST /api/submissions` validates magic bytes and writes the client's own bytes to `submissions/<id>/<position>.<ext>`; only the 224×400 rail thumbnail is re-encoded. The story viewer then loads the stored file full-screen (`story-viewer-element.ts` sets `img.src = story.src` on a `w-full h-full object-contain` stage), so a guest's 3824×2484 PNG — the committed fixtures are 2.4–3.0MB each, ~8MB per submission — is what every viewer downloads, on a phone, at a venue, on congested cellular.

Two further problems fall out of storing the original:

- **Metadata leaks.** The wall is public (public-wall D3) and photo reads are unauthenticated, so whatever the camera embedded is published — GPS coordinates above all. Nothing in the current pipeline strips it.
- **PNG for photos.** Nothing constrains the format, so the worst-case container is the one that arrives.

The efficient format (AVIF) is available but costs ~4× the CPU to encode, and encoding it inside the request would turn "Sharing…" into a 6–12s wait on a 1–2 vCPU VM. That tension — best format vs. a fast upload — is what this change resolves by splitting the work across time rather than choosing one.

## What Changes

- **Uploads are normalized before storage.** Every accepted photo is re-encoded to a canonical WebP: EXIF orientation applied, long edge capped at 2048px, all metadata (EXIF/XMP/IPTC) stripped, quality 80. The stored file is no longer the guest's file. An upload that is _already_ WebP/AVIF, inside the cap, correctly oriented, metadata-free, and no larger than our re-encode is passed through as-is — normalization must never make a photo bigger.
- **Undecodable bytes are rejected pre-claim.** A file whose magic bytes are valid but whose payload is corrupt fails during normalization, which runs _before_ the submission row is claimed, so no cleanup is needed and the guest can retry.
- **AVIF variants are generated after the response.** A bounded in-process queue (concurrency 1) encodes `submissions/<id>/<position>.avif` and `thumb.avif` once the 201 is on its way. The guest never waits for it; if it never lands, nothing breaks.
- **`GET /api/photos/<key>` negotiates format from the same URL.** A request whose `Accept` explicitly lists `image/avif` gets the variant when it exists and the canonical WebP otherwise; every other request gets the canonical. Success responses add `Vary: Accept`. No payload change, no client change, no `<picture>` sidecar that could 404.
- **The queue self-heals.** An AVIF-capable request for a photo whose variant is missing re-enqueues it, which covers a restart mid-encode, a job dropped by the bounded queue, and rows stored before this change.
- **`PHOTO_AVIF_ENABLED`** (default `true`) is a deploy-free kill switch for the background encode.

## Capabilities

### Modified

- `guest-photos` — "Photo limits" now bounds the _upload_, not the stored file (10MB still rejects, but the stored artifact is a re-encoded WebP); "Photos stored on disk under submission-scoped paths" gains the canonical-format rule, the pass-through rule, the metadata-stripping guarantee, and the `<position>.avif` / `thumb.avif` sibling keys; "Submissions API never cached; photo files cacheable" gains `Vary: Accept` on photo successes.

### Added

- `guest-photos` — "Uploads are normalized to a canonical WebP" and "AVIF variants are generated out of band and negotiated per request" (both with their failure modes specified: corrupt payload → 400 pre-claim; variant missing → WebP served and the variant re-enqueued).

### Unchanged / out of scope

- Client-side pre-compression before upload (the browser-resize option) — deliberately deferred; it is a separate change with its own Safari-can't-export-WebP fallback rules.
- HEIC input support. `AddStoryFlow.astro` sets `accept="image/jpeg,image/png,image/webp,image/avif"`, which makes iOS convert camera picks to JPEG. That must stay: this sharp build reports `heif.input.fileSuffix: [".avif"]` and `heif({compression:'hevc'})` → `Unsupported compression`, so a HEIC upload could be neither decoded by sharp nor by `detectPhotoType`.
- Keeping originals for archival. Not stored, so the wall cannot serve one and backups stay small. If the couple later wants print-resolution originals, that is a new capability with a new key namespace.
- Rail geometry, attribution, wish text, post-once semantics, moderation, backups — untouched.
