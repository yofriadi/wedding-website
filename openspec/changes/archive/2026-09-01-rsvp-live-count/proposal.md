# Proposal: rsvp-live-count

## Why

The RSVP section of the wedding site is a dead stub: the venue name is the placeholder "The Grand Estate / San Francisco, California" and the only call to action is a disabled-feeling "RSVP Coming Soon" button (`apps/web/src/pages/index.astro`). Meanwhile invite-holding guests have no way to confirm attendance — even though the invite-identity contract (`invite-session`, `ww_invite_id` cookie) is already live and `guest-submissions` planned RSVP as the next feature on that pattern.

This change makes RSVP real and social: the section shows the true venue (**Graha 58 Gedung Serbaguna UMS**, Surakarta) and a live counter of confirmed attending guests, rendered with the slot-machine rolling-digit effect of the beui.dev **Number Ticker** motion component, so each new confirmation visibly rolls the count upward. Invite holders confirm or decline from the same section; their response is stored against their invite, and the tally updates for everyone.

## What Changes

- **Venue name corrected**: the Event Details block renders "Graha 58 Gedung Serbaguna UMS / Surakarta, Central Java", sourced from a shared `src/lib/venue.ts` constant module so `venue-map-routes` (which lands second per its decided order — see below) reuses the same string instead of duplicating it.
- **Live confirmed-guest counter**: a prominent count of confirmed attending _guests_ (sum of party sizes, not number of responses) rendered with rolling digit columns in the beui.dev NumberTicker style — per-digit staggered roll on first view, immediate rolls on every later update. The count is **public** (an aggregate integer, no identity) and refreshes on a poll interval while the tab is visible.
- **Ticker as a vanilla custom element, not a React island** (key decision — see design.md): the beui component is React + `motion/react`, but (a) its SSR output renders `0` until hydrated and in-view, so a no-JS visitor would see a permanently wrong number, and (b) the repo already animates with imperative `motion` + self-initializing custom elements (`TextShimmer.astro`). The ticker is therefore **ported** to a `<number-ticker>` custom element using `motion`'s `animate()` — same visual, truthful SSR (real count painted as plain text, progressively enhanced), zero new runtime dependencies. No React is added.
- **Server-rendered invitee controls** (key decision): the homepage frontmatter already resolves the invite + `displayName` server-side under `Cache-Control: no-store` (guest-greeting pattern). The RSVP controls — display name, attending/decline choice, party-size stepper capped per invite, current stored response — are rendered server-side for invite holders and are absent from the markup for anonymous visitors; a small client script POSTs changes. No client-side identity fetch is needed for the controls (the `GET /api/rsvp` status endpoint ships anyway as the contract for future surfaces, e.g. a confirmation view).
- **Anonymous visitors see a path**: instead of the removed stub button, a copy line directs them ("RSVP through your personal invitation link") — the invite links remain the only identity channel.
- **All ticker motion respects `prefers-reduced-motion`**: digits render statically and live updates swap instantly.

## Non-goals

- **RSVP deadline enforcement** — the API accepts responses without a cutoff. The FAQ's "we won't be able to accept late RSVPs" wording is reconciled as copy-only (softened), with hard enforcement deferred to a later change if the couple wants it.
- **"See exactly who is invited" per-name party display** — the controls show the invite's display name and a party-size stepper, not a per-person name list; the FAQ promise is reworded to match (the couple can later extend invites with per-person names if they want).
- **Meal choices, dietary notes, or free-text messages** — attending/declined + party size only.
- **Live push (SSE/WebSocket)** — polling while the tab is visible is sufficient at wedding scale; no push infrastructure.
- **Admin reporting UI / RSVP dashboard** — responses are readable via direct DB access and the admin invites endpoint's extended read fields (see design.md); a dashboard is future work.
- **The interactive venue map** — owned by `venue-map-routes`; per that change's decided land order (its tasks 4.1), `rsvp-live-count` lands FIRST and owns the venue-name line and RSVP block; the map inserts above without duplicating the venue line.

## Capabilities

### New Capabilities

- `rsvp-responses`: The RSVP write/read API — cookie-identified upsert of attending status + party size, per-invite caps, public aggregate confirmed-guest count, uniform privacy/cache semantics matching `invite-session`.
- `rsvp-section`: The RSVP UI — venue copy, the rolling-digit live counter custom element, server-rendered invitee response controls, and the anonymous/public states.

### Modified Capabilities

None — no existing spec covers the Event Details/RSVP section (`venue-map-routes` explicitly left the RSVP stub and venue copy to this work).

## Impact

- **Code**: `apps/web/src/pages/index.astro` (section markup/copy, SSR invite resolution), new `apps/web/src/components/RsvpSection.astro` + `apps/web/src/components/number-ticker.ts` (custom element), `apps/web/src/lib/venue.ts` (shared venue constant), `apps/web/src/lib/invite-session.ts` (shared cookie-resolution helper — deduplicates the third copy), new API routes `apps/web/src/pages/api/rsvp/index.ts` (GET own status, POST response), `apps/web/src/pages/api/rsvp/count.ts` (GET public count), `apps/web/src/lib/rsvp.ts` (shared count query), `packages/db/src/schema/rsvps.ts` + migration, `apps/web/src/pages/api/admin/[token]/invites.ts` (accept/return `maxPartySize`, return RSVP fields), `apps/web/src/components/WeddingFAQ.astro` (two copy reconciliations).
- **DB**: new `rsvps` table (`invite_id` PK, `attending`, `party_size`, `responded_at`, `updated_at`); `invites` gains `max_party_size` (NOT NULL, default 1) set per invite by the couple through the admin endpoint. FK enforcement stays documentation-only until `guest-submissions` enables `PRAGMA foreign_keys` (noted, not fixed here).
- **Deps**: none added — `motion@13` is already present and the ticker is vanilla.
- **Security**: first cookie-authenticated _write_ endpoint — authenticate before body parsing, same-origin posture (no CORS headers; `SameSite=Lax` cookie withholds cross-site POSTs), idempotent upsert, uniform-404 identity semantics.
- **Risk**: first write endpoint under the invite cookie (mitigations above); SSR count query must degrade gracefully on DB failure so the homepage can never 500 on the counter.
