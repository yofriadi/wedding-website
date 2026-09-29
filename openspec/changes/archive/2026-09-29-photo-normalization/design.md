# Design: photo-normalization

## Context

`POST /api/submissions` validates each uploaded file (≤10MB, ≤3 files, magic bytes are jpeg/png/webp/avif) and then writes the **client's bytes** to `submissions/<id>/<position>.<ext>`. The only re-encode is the rail thumbnail: `sharp(...).rotate().resize(224, 400, {fit:'cover'}).webp({quality:80})` → `thumb.webp`. `GET /api/photos/<key>` serves whatever file the key names, with `Cache-Control: public, max-age=31536000, immutable`, and the story viewer loads that URL into a full-screen `object-contain` stage.

Consequences observed on the committed fixtures (`var/photos/submissions/*/`): three 3824×2484 PNGs of 2.4–3.0MB each, i.e. ~8MB served into a modal on a phone, and every byte of camera metadata the guest's device wrote is published on an unauthenticated public URL.

## Goals / Non-Goals

**Goals**: bound what a viewer downloads per story slide (both dimensions and bytes) without making the guest wait for it; strip camera metadata from everything the public wall can serve; use the most efficient format the _requesting browser_ can actually decode; keep the wall payload, the client, the key namespace and the backup/restore tooling unchanged; never regress a photo that arrives already optimal.

**Non-Goals**: client-side pre-compression (separate change); HEIC input; archival originals; on-demand variants at arbitrary sizes (there are exactly two — rail thumb and full — and both are known at ingest); any third-party image service.

## Decisions

### D1 — Normalize in-process with sharp, not with a service

sharp 0.34 / libvips 8.17 is already a dependency and already runs at upload time for the thumbnail. The alternatives were evaluated and rejected on evidence, not preference:

| option                                                   | verdict               | why                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **wsrv.nl** (free, keyless, libvips behind Cloudflare)   | rejected              | Tested live: `output=avif` → `{"status":"error","code":400,"message":"Saving to avif is disabled. Supported savers: jpg, png, webp, tiff, gif, json, jxl"}`. Its best output is WebP — identical to what sharp produces locally — in exchange for a third party fetching guest photos by public URL and an as-is hobby quota.                                 |
| **Cloudinary / ImageKit / Uploadcare free tiers**        | rejected              | Real but thin (Cloudinary free ≈ 25 credits/mo across storage+bandwidth+transforms; ImageKit ≈ 20GB bandwidth/mo), uploads go client-side to their endpoint, so guest photos live in third-party custody and a cloud name + unsigned preset ships in the bundle. Cuts against the privacy posture the invite spec takes elsewhere (no IP/UA/referrer stored). |
| **imgproxy / thumbor** (self-hosted OSS, free, no quota) | rejected              | The only defensible service shape, but it is a second container + RAM on a VM already running Node/SQLite/Caddy, and it exists for _on-demand_ variants. Two known variants at ingest do not need a proxy.                                                                                                                                                    |
| **Cloudflare free Cache Rule for `/api/photos/*`**       | deferred, with a trap | Genuinely free bandwidth, but see D6: a free-plan edge cache ignores `Vary: Accept` and would serve one visitor's AVIF to a browser that cannot decode it.                                                                                                                                                                                                    |

### D2 — Canonical WebP in-request; AVIF as a post-response sibling

Measured on an M1 Pro with a photo-realistic 12MP fixture (1.14MB JPEG in):

| artifact                        | size                 | encode time | where          |
| ------------------------------- | -------------------- | ----------- | -------------- |
| canonical WebP q80 e4 @ ≤2048px | 362KB                | ~0.39s      | **in request** |
| AVIF q55 e4 from the canonical  | 246KB (−32% vs WebP) | ~1.2s       | background     |
| thumbnail WebP 224×400 q80      | 25KB                 | ~0.04s      | in request     |
| thumbnail AVIF q55 e4           | 20KB                 | ~0.16s      | background     |
| 1000×700 PNG upload (2.02MB)    | → 62KB WebP (33×)    | ~0.07s      | in request     |
| same fixture, NO resolution cap | 523KB WebP           | ~0.46s      | (rejected)     |

Three photos therefore add ~1.2s to the POST and ~3.8s of background work. On a shared 1–2 vCPU VM expect 2–4× those numbers, which is exactly why AVIF cannot be in the request path: 3 × (1.2s × 3) ≈ 11s of "Sharing…".

WebP is the canonical because it is the format that is safe to serve to _every_ browser unconditionally (Chrome 50+, Safari 14/iOS 14+, i.e. ~100% of a 2026 wedding audience). AVIF is the upgrade, not the baseline: Safari on iOS ≤ 15.8 has no AVIF decoder at all, and on iOS every browser is WebKit, so WhatsApp's in-app browser — how most guests will open this link — inherits the OS's limit.

`MAX_PHOTO_EDGE = 2048` because the viewer panel is `max-w-lg` on desktop but `w-full h-full` on mobile (~440×956 CSS px → ~880×1912 at DPR 2). 1600px would be ~35% smaller and only marginally soft at DPR 3; 2048 is the choice that keeps a full-screen story crisp on every phone in the room. The cap is the bigger lever anyway: on the fixture above, removing it grows the WebP from 362KB to 523KB — more than the AVIF step saves.

### D3 — One URL, negotiated by `Accept`, with `Vary: Accept`

The variant is chosen in the route, not in the markup. The alternative — exposing `avifUrl` in the wall payload and rendering `<picture><source type="image/avif">` — was rejected for three reasons:

1. A `<source>` that 404s **breaks the image** rather than falling through. `StoryViewer.astro` already documents this for static assets, and with a post-response encode the sidecar genuinely does not exist for the first seconds after an upload. Emitting it only when the file exists would work, but then the payload, `submissions-client.ts`, `guest-rail.ts`, `story-viewer-element.ts`, `StoryViewer.astro` and a dozen `guest-rail.spec.ts` fixtures all change shape for a file that may or may not be there yet.
2. Negotiation in the route covers the thumbnail and every pre-existing row with zero client work.
3. The URL stays write-once, so `immutable` caching remains true.

`Accepts-AVIF` requires an **explicit** `image/avif` media range with a non-zero `q`. `*/*` is not treated as AVIF support: curl, prefetchers and some WebViews send it, and guessing wrong is a broken image rather than a slightly larger file.

### D4 — Encode the AVIF variant from the canonical, not from the upload

The original is never stored, so the choice is really "canonical" vs "hold the original in memory until the variant lands". Canonical wins: a background job then holds 362KB instead of up to 10MB, the variant is guaranteed pixel-identical in geometry to what the WebP branch serves, and the self-healing backfill (D5) uses the same code path as the upload path. The cost is one extra lossy generation (WebP q80 → AVIF q55), which at these qualities is not distinguishable on a phone screen. `AVIF_QUALITY`/`AVIF_EFFORT` are single constants if that ever needs revisiting.

Measured on a real legacy row (`var/photos/submissions/VfZ6KUFyR8Y2/0.png`, 2.44MB, stored before this change): the first AVIF-capable GET served the PNG and queued the variant; one second later the same URL served a 125KB AVIF — 19.5× smaller — with no migration and no client change.

### D5 — A bounded in-process queue that also self-heals

One Node process, ~100 guests, no worker infrastructure worth its weight: a FIFO array with concurrency 1, a `pending` set for dedupe, a `failed` set so a corrupt canonical is not retried forever, and a depth cap of 64 that **drops** rather than grows. Dropping is safe because `GET /api/photos` re-enqueues whenever an AVIF-capable request finds no variant — which also covers a restart mid-encode and rows stored before this change (including the `.png` fixtures: their canonical is re-encoded lazily on first request). Failures are logged and non-fatal: the canonical still serves.

The drop branch logs (`[avif-queue] depth cap 64 reached, dropping variant job: <key>`). It is the one condition that says "this host cannot keep up with variant generation", it is invisible on every other surface, and `ops/README.md`'s operational story for this queue is _watch the journal_ — a silent drop would leave that story with a hole in it.

The queue is triggered from the POST _before_ the 201 is returned, but `enqueueAvifVariant` is fire-and-forget and cannot throw, so it can never turn a successful post into a 503 and never participates in the atomic-ish cleanup path.

### D6 — Edge caching is the one thing this design constrains

Photo successes now carry `Vary: Accept`. Cloudflare's free plan does not vary its cache on `Accept` for images ("Vary for Images" is a paid feature), so a free Cloudflare Cache Rule on `/api/photos/*` could serve one visitor's cached AVIF to an iOS 15 browser. Documented in the route header and in `ops/README.md`: either pay for Vary for Images, or keep this route out of the edge cache. The `immutable` + 1y `Cache-Control` is unchanged, so a **browser**-side cache is unaffected and still does most of the work at a venue (the same photos get re-opened repeatedly).

### D7 — Pass-through is WebP-only, and JPEG/PNG/AVIF never take it

A WEBP upload that is ≤2048px, orientation 1 or unset, carrying no EXIF/XMP/IPTC, and no larger than our re-encode is stored as-is. Without that rule, normalization could _increase_ bytes — a small WebP from a modern Android is smaller than anything we would produce at WebP q80 — and "compress on upload" would be a regression for exactly the guests with modern phones.

JPEG and PNG are always re-encoded even when the result is larger, because re-encoding is the only way their EXIF is provably gone (sharp strips metadata on output unless `withMetadata()` is requested, and `.rotate()` consumes the orientation tag instead of preserving it). The metadata-free condition on the pass-through is what keeps the shortcut from smuggling GPS onto a public wall.

**AVIF uploads are re-encoded too**, which costs bytes to buy a guarantee. Measured with the test fixture: a 58KB AVIF upload becomes a 138KB WebP canonical plus an 86KB variant — ~4× the bytes the guest sent, and the variant is a generation worse than their original. In exchange, the invariant "the canonical is decodable by every browser" holds unconditionally, which is what makes the route's fallback safe: an AVIF canonical would be served verbatim to iOS ≤ 15.8, where there is no AVIF decoder at all — and because the viewer starts its progress timer on `img.onload`, those guests would get a stuck spinner rather than even a broken-image icon.

The cheaper-on-bytes alternative is a second variant direction: keep the guest's AVIF as canonical and generate a WebP _fallback_ beside it, negotiating downward for old browsers. It is strictly better for AVIF uploads (58KB for modern guests, 138KB for old ones) but doubles the negotiation matrix and needs its own queue job type, for an input format the picker almost never produces. Deferred, with a concrete trigger: if real submissions show AVIF uploads arriving at any rate, add the fallback direction rather than re-litigating the canonical rule.

The pass-through does NOT save request-path CPU: "no larger than our re-encode" can only be evaluated by producing the re-encode first, so a passed-through upload still pays the ~0.39s WebP encode and then discards it. That is inherent to the rule, not an oversight — the alternative (guessing from the input's size and format) is how a normalization step ends up making photos bigger.

### D8 — Corrupt payloads fail as 400, before the claim

Normalization runs inside `parseMultipart`, i.e. before the submission row is claimed. A file whose magic bytes pass but whose payload is truncated throws in sharp; the route maps that to `invalid_photo_type` (400) and logs the underlying error. Nothing was written, so the atomic-ish cleanup requirement is not engaged and the guest may retry. `failOn: "none"` keeps the tolerant cases tolerant (a slightly-off JPEG still posts), and `limitInputPixels: 64_000_000` replaces sharp's 268MP default so a ≤10MB PNG cannot ask libvips for ~1GB of decoded pixels — 64MP still admits a genuine 48MP phone capture.

### D9 — Writes are atomic, because photo responses are cached for a year

Variant files are written _after_ their canonical key is already published (the 201 returned it and the wall payload serves it), so a plain `writeFile` is observable mid-write: a concurrent AVIF-capable GET can `stat` the partial file, read truncated bytes, and serve them under `Cache-Control: immutable, max-age=31536000` — turning a millisecond race into a browser-cached broken image for a year. Every photo write therefore goes through one helper: a `<file>.part` temp in the same directory (`rename()` across filesystems fails with EXDEV, so the temp cannot live elsewhere), then `rename()` into place, with the temp removed if either step throws. The upload path uses the same helper — its race is far narrower (nobody knows an unguessable key until the 201) but there is no reason to keep two write paths with different guarantees.

Consequences handled rather than left as trivia: `backup.sh` excludes `*.part` (rsync instead of `cp -R`), `restore-drill.sh` excludes them from both checksum trees so a mid-write backup cannot produce a phantom diff, and the pipeline test asserts an EXACT directory listing so a leftover temp fails loudly instead of littering a live photo directory.

## Risks / trade-offs

- **Double lossy generation** for AVIF (D4). Accepted; constants are tunable and the canonical is the quality anchor.
- **Background CPU on a small VM.** A burst of uploads queues rather than parallelizes; `PHOTO_AVIF_ENABLED=false` removes the cost entirely without a deploy, and existing variants keep serving.
- **Queue state is process-local.** A restart loses `pending`/`failed`; the GET-triggered backfill makes that a delay, not a loss.
- **No originals.** A guest's full-resolution photo is not recoverable from the site after this change (it never was served, but it was stored). If print-resolution archival is wanted, it needs its own decision — a separate key namespace outside the served regex, plus backup-size consequences.
- **Old rows are not migrated eagerly.** `submissions/*/0.png` fixtures keep serving until an AVIF-capable request triggers a backfill; the canonical for those rows is never rewritten (rewriting a stored key would break the write-once `immutable` promise).

## Migration

None. `KEY_RE` already permitted `[0-2].avif`; it gains `thumb.avif`. New uploads write `.webp` canonicals; existing `.png`/`.jpg` rows keep serving through the same route, and their variants appear lazily. No DB change, no client change, no payload change.
