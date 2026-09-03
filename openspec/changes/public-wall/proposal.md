# Proposal: Public wall

## Why

Guests who received no invite link (public URL visitors) currently see only demo tiles and the invite-only teaser framing — even after real stories and wishes exist. The couple wants the wall (stories + wishes) to be public: anyone with the site URL sees guest posts. The "invite-only" teaser framing is then wrong once content exists, so it retires at that moment.

## What Changes

- **`GET /api/submissions` serves the wall to anonymous callers.** No cookie → `mine: null` + the full wall (same shape invitees get minus `mine`). Cookie holders are unchanged.
- **Photo files are publicly fetchable.** `/api/photos/[...key]` no longer 404s for anonymous callers; success caching flips `private` → `public` (shared caches may serve them — keys are unguessable submission-scoped paths).
- **The story rail renders wall tiles for the public.** `guest-rail.ts` and `submissions-client.ts` drop the public early-return; the public page now fetches `/api/submissions` once per load (zero-request guarantee is retired).
- **The wish marquee renders real wishes for the public** (currently demo-only until an invite cookie exists).
- **Teaser tiles retire when real photos exist.** The SSR gate that already evicts mock tiles (`showMockStoryTiles`) extends to the couple-supplied `storyTeasers` — empty wall → teasers + mocks; any real photo → neither.
- Posting stays invite-only (the add-story tile, `POST /api/submissions`, the add-story flow, and `mine` remain cookie-gated).

## Capabilities

### Modified

- `guest-photos` — "Photos served to invitees only via the wall" becomes "Photos served via the wall" (public); anonymous direct file access now succeeds; wall payload served to anonymous callers.
- `story-teaser` — teaser tiles retire once any real guest photo exists (same gate as the mocks).
- `story-rail-mocks` (spec: `story-rail-mocks`) — mock eviction stays as-is (already cookie-blind); the public rail now also renders wall tiles after eviction, so the empty-rail-for-public gap disappears.
- `add-story-flow` — unchanged behavior; noted because the wish marquee's public rendering shares its payload.

### Unchanged / out of scope

- Invite links, RSVP, welcome gate, admin — untouched.
- The rail's egress control (tiles render 224px thumbnails, never originals) — unchanged.
- No name attribution anywhere in the wall payload (D1a) — unchanged.
