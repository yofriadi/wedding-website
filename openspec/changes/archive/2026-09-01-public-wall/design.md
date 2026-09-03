# Design: public-wall

## Context

`guest-submissions` + `story-rail-mocks` shipped the wall as an invitee-only surface: `GET /api/submissions` and `/api/photos/[...key]` 404 for anonymous callers, the client makes zero submissions requests without a cookie, and the rail/marquee degrade to demo/teaser content for the public. The couple now wants the wall public: guests without an invite link should see real stories and wishes, and the "you'll see stories here if invited" teaser framing should retire once real content exists. The empty-wall state (mocks + teasers) keeps its existing purpose.

## Goals / Non-Goals

**Goals**: anonymous visitors see wall stories in the rail and real wishes in the marquee (same content invitees see, minus `mine`); teaser tiles retire on the same SSR gate the mocks already use; photo files are publicly fetchable with shareable caching; posting stays invite-only; no new DOM for the public path (the existing client render path just loses its cookie gate).

**Non-Goals**: making `mine` meaningful for anonymous callers; changing post-once, add-story tile visibility, or the add-story flow; attribution (wall stays anonymous by design); public RSVP/wish submission; changing demo tiles or mock tiles; SSR-rendering the wall server-side (the client fetch stays the single source of truth for wall tiles).

## Decisions

### D1 — API: wall-shaped payload for anonymous callers, not 404

`GET /api/submissions` resolves the invite as today but treats `not_found` as "anonymous" rather than "reject": respond `{ mine: null, wall: { wishes, stories } }` (200). Everything else is unchanged — same ordering, same dedupe rules, same 503 on operational error. `mine` requires a resolved invite by construction.

The uniform-404-forever stance ("endpoint existence never leaks") is retired deliberately: the endpoint is now a public read API. `resolveInvite`'s `not_found` keeps its meaning for every OTHER consumer (invite/me, RSVP, photo auth is changing too — see D3), so no shared helper changes shape.

### D2 — Client: drop the cookie gate, keep one render path

`submissions-client.ts`: `loadSubmissions()` fetches for everyone; `hasInviteCookie()` stays (add-story tile + flow still use it). The zero-request guarantee for the public is retired and its tests updated.

`guest-rail.ts`: `initGuestRailState()` no longer early-returns for the public; the public simply gets `mine: null` → no add-story tile (SSR already omits it without a cookie-shaped cookie), wall tiles render. `applySubmissionsState`/`syncMockTiles`/generation guard unchanged.

`WishMarquee.astro`: `init()` drops its `hasInviteCookie()` early-return; `load()` already handles `mine: null` + empty wall via the demo state. The marquee's public zero-request test flips to assert exactly one request.

### D3 — Photos: public reads, shareable caching

`/api/photos/[...key]` removes the invite resolution for GET: keys are unguessable (submission-scoped, generated IDs), photos are non-secret by decision, so anonymous reads succeed. Success `Cache-Control` flips `private` → `public` (a shared cache/CDN may now serve them; `immutable` + 1y max-age unchanged since keys are write-once). 404s stay `no-store`.

Anonymous 404-on-guessed-path is now **success-equivalent** to anonymous 404-on-missing-file by content (both simply "no such photo"), so the uniform-404 indistinguishability argument dissolves — the only thing still hidden is _which_ keys exist, which unguessability already provides.

### D4 — Teaser retirement: extend the existing SSR gate

`index.astro`'s `showMockStoryTiles = !hasAnyGuestPhoto` gate already encodes "real content exists". Teasers get the same condition: render `storyTeasers` only when `!hasAnyGuestPhoto`. Empty wall → teasers + mocks + demos; any real photo → teasers and mocks both gone (SSR, cookie-blind). Fail-open stays (DB error → teasers + mocks render).

The teaser tiles are lazy (`data-src` + progressive hydration), so removing them from the empty state costs nothing at runtime; the `teaserAssetExists` scan stays for the empty state.

### D5 — Spec reconciliation

- `guest-photos`: "Photos served to invitees only via the wall" → "Photos served via the wall" — anonymous callers get the wall payload and photo files. The anonymous-rail-unchanged and anonymous-404 scenarios are replaced. `Cache-Control` requirement updates `private` → `public` on success.
- `story-teaser`: the capability is now conditional — teaser tiles exist only while the wall is empty; add the retirement requirement (shared gate with the mocks). The "invite-only framing" copy is the tiles themselves, so no separate copy change.
- `story-rail-mocks` (archived change's spec deltas): mock eviction is already cookie-blind and unchanged; the spec delta here only notes the public rail now renders wall tiles post-eviction (the empty-public-rail gap closes).
- `add-story-flow`: no behavior change; not touched.

### Risks

- **Egress/privacy**: photos become fetchable by anyone with a URL. Accepted by the couple (decision recorded in proposal). Thumbnails-only egress in tiles unchanged; originals are reachable only by design through the viewer modal (same as invitees today).
- **Load**: the public page now makes one submissions GET + N thumbnail requests. Bounded by the existing caps (wall ≤ 30 stories, marquee ≤ 24 wishes, 224px thumbnails).
- **Cache correctness**: homepage stays `no-store` (per-invite personalization); photo responses flipping to `public` is safe because keys are write-once and unguessable.
