# Design: guest-submissions

## Context

The invite-identity contract and deployment substrate ship in `invite-only-personalization`: `GET /api/invite/me` resolves the `ww_invite_id` cookie; the app runs on a self-hosted Tencent CVM (S5.MEDIUM4, Singapore, Ubuntu 26.04) via the node adapter behind Caddy; SQLite is a local file; the story rail is a demo+teaser state with no add-tile; `TestimonialMarquee.astro` is ambient decoration; the old `WishMarquee.astro` mockup is dead code. This change builds guest content on that substrate. Product decisions locked in exploration: submissions invite-only; one post per invite; no author attribution displayed; wish text and photos are one flow; marquee rename; demo content stays for public and empty states. Timeline: site release ~Sep 19, wedding Oct 10, VM expires Oct 18 (with a 15-day recycle-bin grace, ~Nov 2) — this change owns the backup/archive duty.

## Goals / Non-Goals

**Goals**: one coherent submission flow (wish text + photos); invite-only visibility; post-once enforcement with clean 409 semantics; a readable wish surface; a safe-by-default photo pipeline on local disk; every display state designed; reliable backups before VM expiry.

**Non-Goals**: edit/delete submissions; couple moderation UI; households; public visibility; RSVP; photo resizing (egress is metered at $0.081/GB but wedding-scale estimates are a few dollars — accepted; resize is a later optimization).

## Decisions

### D1 — Data model: one submission row per invite

Table `submissions`: `id TEXT pk` (12-char random, invites generator), `invite_id TEXT NOT NULL UNIQUE REFERENCES invites(id)`, `wish_text TEXT NULL` (trim; 1–500 chars when present), `created_at INTEGER NOT NULL`. Table `submission_photos`: `id TEXT pk`, `submission_id TEXT NOT NULL REFERENCES submissions(id)`, `key TEXT NOT NULL`, `position INTEGER NOT NULL` (0–4), `created_at INTEGER NOT NULL`. A submission MUST contain at least one of wish_text / photos (API-enforced). `UNIQUE(invite_id)` is the entire post-once enforcement. T2 resolved: one post total, containing either or both.

#### D1a — No names stored on submissions

No display_name is copied onto submissions. Rendering reads only wish text/photos; the caller's own submission is identified via the session (`mine`), never by name. Attribution does not exist, by product decision (W4).

### D2 — Endpoints (cookie-gated via invite-session)

- `POST /api/submissions`: multipart `{ wishText?, photos? }`. Cookie required. Validates: wishText 1–500 after trim; photos ≤5, each ≤10MB, magic-byte types jpeg/png/webp/avif; at least one of text/photos. UNIQUE violation → `409 { error: "already_posted" }`. Success `201`. `no-store`.
- `GET /api/submissions`: cookie required. Returns `{ mine, wall }` — `mine` is `{ id, wishText, photos: [{ photoUrl }] }` (photo entries ordered by position) or `null`; `wall.wishes` is `[{ text }]` newest-first; `wall.stories` is an array of submissions newest-first, each `{ photos: [{ photoUrl }] }` (positions are per-submission and NOT exposed on the wall). No name fields anywhere. `no-store`.
- Photo URLs are app-served routes (see D4a), not static file paths.

### D2a — Uniform invisibility for the public

Every submissions endpoint returns the same `404` body shape for missing/malformed/unknown cookie as `/api/invite/me` — endpoints behave as nonexistent for the public. No CORS headers; same-origin only.

### D3 — Wish surface: renamed WishMarquee

Delete `WishMarquee.astro` (old mockup). Rename `TestimonialMarquee.astro` → `WishMarquee.astro` (file + import). It remains ambient decoration for the public (demo wishes, opacity 0.1) and becomes readable for invitees: when real wishes exist, rows render real wish text; styling raises to readable opacity with pointer-events enabled only in the real state. Display states (invitee): **0 real wishes** → demo + leading "Be the first to leave a wish ✨" card; **≥1 real wish** → real only (demo evicted). Public: demo only, no fetch, decorative styling unchanged.

#### D3a — Marquee loop integrity

Client repeats the real wish list until each row's content width exceeds the track width before duplicating (demo already repeats 4×; real lists of 1–3 must repeat to fill). All four rows rebuild as a unit; per-row animation timing preserved. Wishes longer than ~80 chars are visually clamped (ellipsis/gradient fade).

### D4 — Photo pipeline on local disk (was R2)

Storage: local content directory outside the web root (e.g. `/srv/wedding/photos/`). Upload path: multipart → validate all (magic bytes, size, count) before writing anything → write to disk at server-generated keys (buffered, not zero-copy — see L6b) `submissions/<submission-id>/<position>.<ext>` (client filenames never trusted; path traversal refused) → record in `submission_photos`. No resizing in v1 (L6 accepted: bounded by post-once + 5×10MB + ~200 invites; egress estimate a few dollars for the season). Disk usage bounded: worst case ~10GB (200 × 5 × 10MB), realistic 1–3GB — must fit the system disk (≥20 GiB, expandable online).

#### D4a — Photos served through the app, never a public static dir

A photo route (e.g. `GET /api/photos/<key>`) requires a valid invite cookie, validates the key shape, streams the file with correct content-type, and returns uniform 404 otherwise. This keeps the invite-only gate real (a guessed path fails for anonymous) while letting the route send `Cache-Control` suitable for immutable content (keys are write-once) — unlike the submissions API (`no-store`).

#### D4b — Upload abuse limits

Per-invite: 1 submission (UNIQUE) + 5 photos + 10MB each ≈ hard cap 50MB per invite, bounded by the invite population. Post-once bounds _successful_ writes but is NOT a rate or memory limiter for _rejected_ attempts. **Pre-buffer body limit (review 4, blocker 2):** because `request.formData()` buffers before validation, an arbitrary-size or chunked body would be buffered in full before any 400. Caddy enforces a request-body ceiling on `POST /api/submissions` (e.g. `request_body { max_size 60MB }` — 50MB content + multipart overhead), covering chunked bodies and rejecting before Node touches the payload. App still authenticates before parsing and keeps per-file/count/type checks after. Verify both oversized Content-Length and chunked requests are refused without Node memory growth.

### D5 — Add-story flow (UI)

The story rail gains an invite-only "Add Story" tile (visible only when cookie present AND `mine` is null). Tap → one screen with wish text (optional, 500 chars) and photo picker (optional, ≤5, client-side pre-validation). Submit → `POST /api/submissions` → on 201: tile disappears, marquee swaps per D3, rail shows own photos; on 409: already-posted state; on 400: inline field errors; network failure: flow stays open with retry.

### D6 — Backup & archive duty (VM expires Oct 18)

The whole site state is one SQLite file + one photos directory. A nightly cron ships both off-box (`sqlite3 .backup` + rsync/rclone to the couple's local machine or object storage). Before Oct 18, a final archive run captures everything; the 15-day recycle-bin grace (~Nov 2) is backstop, not plan. Optionally later: freeze the final state as a static memorial (Cloudflare Pages, free).

### D7 — Landing order

1. Marquee rename (pure refactor).
2. Data model + `POST`/`GET /api/submissions` (wish-text only) + marquee states.
3. Photo path (disk storage + photo route + rail rendering) + add-story flow UI.
4. Backup cron + close-out verification.
   Each step shippable independently.

## Risks / Limitations (numbered L6+ to match earlier exploration)

- **L6 — Egress: the "few dollars" estimate was wrong (review 6, B3)**. The rail tile renders `src={lastStory?.src}` — a full 10MB-cap original as a 112×200 thumbnail with no lazy-loading — so each invitee page load could pull ~200MB of originals; tens of GB over the season at $0.081/GB is $10–30+, not "a few dollars". Mitigations (task 3.4): `loading="lazy" decoding="async"` on tiles, cap the rail to N most recent submissions, and generate one small thumbnail per submission at upload (a single sharp resize ≪ the bandwidth it saves). Originals remain viewable in the modal; only the rail serves thumbnails.
- **L6b — Upload memory pressure (do NOT claim streaming)**: Astro route handlers reading `request.formData()` buffer the multipart body in memory before files are accessible; true streaming-to-disk requires manual body parsing, which v1 does not do. One submission ≤50MB transient is trivial, but N concurrent uploads multiply it (10 simultaneous ≈ 500MB on a 4GiB box shared with node + caddy + sqlite). Accepted for v1 at wedding scale (post-once bounds concurrency); if pressure shows, lower the per-file cap or serialize uploads. The D4 phrase "stream to disk" means _write to disk after buffering_, not zero-copy streaming.
- **L7 — Disk exhaustion**: worst-case photos ~10GB; must fit disk (≥20 GiB; expandable online); `df` check belongs in deploy verification; uploads could be disabled at a disk watermark later if ever needed.
- **L8 — Content moderation**: post-once + no-names is the whole moderation story; couple-side delete is future.
- **L9 — Marquee readability shift**: raising opacity/pointer-events in the real state changes the section's visual weight; needs design eyeballing at implementation time.
- **L10 — 409-on-race UX**: concurrent double-submit resolves to one row; loser sees already-posted state — same UI as having posted.
- **L11 — VM expiry timing**: submissions peak in the days after the wedding (Oct 10–17); the VM survives the peak but dies 8 days after the wedding — final archive must not slip past the grace window (~Nov 2).
- **Cross-change dependency**: requires `invite-only-personalization` shipped first (invite-session contract, deployment substrate, removed add-tile).
