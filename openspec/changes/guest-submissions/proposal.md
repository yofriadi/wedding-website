# Proposal: guest-submissions

## Why

Guests currently experience the wedding site read-only. The couple wants guests holding invite links to leave their mark — wishes (text) and story photos — through one submission flow, and those submissions must render only for other invite holders (the public sees teaser/demo content). The invite-identity contract (`invite-session` from `invite-only-personalization`) makes this possible without accounts: the cookie is the identity, and one-post-per-invite keeps moderation trivial.

## What Changes

- **One submission flow ("Add Story")**: an invite-only entry point opens a flow where a guest may add a wish (text) and upload photos — together or individually. Text-only, photo-only, and photo+text are all first-class.
- **Wish surface**: `TestimonialMarquee` is renamed to `WishMarquee` (component + import) and becomes the real wish surface: it displays real guest wishes when any exist, demo content otherwise; visible to invitees only in its real state. The old hand-built `WishMarquee.astro` (unwired mockup) is deleted.
- **No author attribution displayed**: wishes and stories render without names — no "— Sarah", no family names. A caller's own submission is identifiable only to themselves via the session contract.
- **Invite-only visibility**: all real guest content (wishes, stories) and the add-story flow render only for cookie holders. Public visitors see demo/teaser states.
- **Post-once per invite**: each invite may create exactly one submission (wish text and/or photos belong to that single submission). `UNIQUE(invite_id)` at the DB level; second attempts and races → `409`.
- **Photo pipeline on local disk**: upload endpoint accepting up to 5 images per submission (≤10MB each, magic-byte validated), streamed to a VM content directory at server-generated keys; served back through a cookie-gated app photo route (never a public static dir).
- **Backup & archive duty**: nightly cron backs up the SQLite database and photos directory off-box; final archive before VM expiry (Oct 18; 15-day recycle-bin grace).

## Non-goals

- **Editing submissions after posting** — the single submission is immutable for now; delete/edit is future work.
- **Moderation UI for the couple** — post-once + no-attribution is the moderation story.
- **Households / multiple submissions per invite** — one invite = one identity = one submission.
- **Public visibility of guest content** — deliberately invite-only.
- **RSVP** — separate future feature following the same invite-session pattern.
- **Photo resizing at upload** — egress is metered but wedding-scale estimates are a few dollars; resize is a later optimization if bandwidth surprises.

## Capabilities

### New Capabilities

- `guest-wishes`: Wish submission (text), display states on the wish marquee (demo / be-the-first / real), no-attribution rendering.
- `guest-photos`: Photo upload, local-disk storage, limits, cookie-gated photo route, and story-rail rendering of guest photos.
- `add-story-flow`: The single invite-only submission flow combining wish text and photos.

### Modified Capabilities

None — `openspec/specs/` has no existing specs.

## Impact

- **Code**: `apps/web/src/pages/index.astro` (rail section, add-story entry), `TestimonialMarquee.astro` → rename `WishMarquee.astro` (delete old `WishMarquee.astro` first), new API routes (`/api/submissions`, `/api/photos/<key>`), `packages/db/src/schema/` (new `submissions` + `submission_photos` tables).
- **Infra**: VM content directory (`/srv/wedding/photos/`) with correct ownership/permissions; nightly backup cron; disk watermark awareness (worst case ~10GB photos).
- **Risk**: first file-upload surface on the site — abuse surface (size, type, path traversal) must be constrained server-side. Display states must degrade gracefully at every population level (0 wishes, 0 photos).
