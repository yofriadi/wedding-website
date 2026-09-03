# Design: rsvp-live-count

## D1. Ticker implementation: vanilla custom element (port), not the React component

**Decision.** Port the beui.dev NumberTicker visual (slot-machine digit columns, staggered entrance, immediate live rolls) to a self-initializing `<number-ticker>` custom element using `motion`'s imperative `animate()`. Do NOT add `@astrojs/react`.

**Why not the React component as published:**

1. **SSR paints the wrong number.** With `startOnView`, the component renders `armed ? digit : 0` — server HTML shows `0` in every digit column regardless of the real count, and only the `sr-only` span carries the truth. A no-JS visitor would see "0 guests confirmed" forever: a _wrong_ number, worse than none. The honest SSR fallback the UI spec needs is structurally unavailable from the vendored component.
2. **Repo precedent.** `apps/web/src/components/` already animates with imperative `motion` (`TimelineScroll.astro`, `StoryViewer.astro`, `WeddingFAQ.astro`), and `TextShimmer.astro` is exactly a self-initializing custom element (`customElements.define`, guard against re-registration). `guest-submissions/tasks.md` 4.3 recommends this pattern for dynamic init.
3. **Cost.** The React route adds `@astrojs/react` + `react` + `react-dom` + `@types/*` + `clsx` + `tailwind-merge` (the last two exist only for `cn` in the vendored file), a tsconfig `jsx`/`jsxImportSource`/`paths` setup, and the site's first hydration boundary — a permanent architectural commitment for one number.

**The port (~80 lines):** markup is server-rendered by Astro as plain digits (truthful at first paint, no-JS-safe); on connect the element replaces each digit with a 1.1em-tall, `1ch`-wide clipped column of 0–9 and animates `y` with `animate(..., { ease: [0.16, 1, 0.3, 1] })` (the beui `EASE_OUT` token, inlined — no `lib/ease.ts` needed). Place-value keying from the original is preserved: columns are keyed from the right so growth adds a column on the left without remounting lower places. Entrance stagger plays once (attribute/flag); later `value` mutations roll immediately. `matchMedia('(prefers-reduced-motion: reduce)')` → digits stay plain text, updates swap instantly. Attribution comment to beui.dev retained at the top of the file.

## D2. Invitee controls: server-rendered, not client-fetched

**Decision.** `index.astro` frontmatter already resolves the invite (cookie → lookup → `displayName`) under `no-store` for the greeting. `RsvpSection.astro` receives the invite context as props and server-renders the controls — display name, attending/decline buttons, stepper capped at `max_party_size`, stored response pre-selected — plus a small `<script>` that POSTs on submit. Anonymous HTML contains no controls and no empty shell, by construction (stronger than a cookie-gated client fetch).

**Consequence.** `GET /api/rsvp` is not consumed by the page. It still ships (small, contract-complete) because a post-submit confirmation view and `guest-submissions` surfaces will need it; the spec keeps it but the UI does not depend on it.

## D3. API shape

- `POST /api/rsvp` — **authenticate first**: resolve cookie (uniform 404 for missing/malformed/unknown, identical to `/api/invite/me`) → _then_ parse/validate body (400). An anonymous caller can never distinguish the route's existence from response shape. Body: `{ attending: boolean, partySize?: number }`; attending requires `1 ≤ partySize ≤ max_party_size` (else 400 `{ "error": "party_size_out_of_range" }`); invalid JSON/shape → 400 `{ "error": "invalid_body" }`. Upsert keyed by `invite_id`; `onConflictDoUpdate` updates `attending`/`party_size`/`updated_at` and **deliberately excludes `responded_at`** (first-response timestamp survives changes of mind). Decline stores `party_size = 0`. 200 echoes the stored values. Error codes follow the `admin/[token]/invites.ts` `{ error: string }` convention.
- `GET /api/rsvp` — own status: `{ attending, partySize, maxPartySize }`, `null`s when unresponded; same 404/503 semantics.
- `GET /api/rsvp/count` — public, no cookie: `{ count }` = `COALESCE(SUM(party_size), 0)` over `attending = true` (SQLite `SUM` over zero rows is `NULL` — coerce). Integer only, never per-invite data.
- All responses `Cache-Control: no-store`. Invite id never in URL/body. No CORS headers: same-origin only; the `SameSite=Lax` cookie is withheld on cross-site POSTs, which is the CSRF posture (stated explicitly, as `guest-submissions` D2a does).
- **Single aggregate helper**: `getConfirmedGuestCount()` lives in `src/lib/rsvp.ts` and is used by both `count.ts` and the `RsvpSection.astro` frontmatter — the `SUM` logic exists exactly once.
- **`SQLITE_BUSY` is a 503, not a silent success**: the concurrency contract is "at most one row survives, last write wins"; a busy writer maps to retryable 503 (consistent with the existing 503 rule), never a partial write.
- **Shared identity helper**: `src/lib/invite-session.ts` exports the cookie name, `INVITE_ID_RE`, `notFound()`, `serviceUnavailable()` — the third consumer stops copy-paste (existing copies in `invite/me.ts`/`invite/opened.ts` may be migrated opportunistically but are not required by this change).

## D4. Counter client behavior (the wrapper script in `RsvpSection.astro`)

- SSR paints the real count (via `getConfirmedGuestCount()`, try/catch → on failure render the counter with count 0 and skip the poll init — the homepage must never 500 on the counter).
- Poll `/api/rsvp/count` every **30 s** (tunable constant, not normative), **only while `document.visibilityState === "visible"`** (mandatory pause; the endpoint is `no-store` and does a table aggregate per call). No fetch on connect — the SSR count is fresh.
- On a changed value, set the element's `value` → digits roll. Poll failure keeps the last displayed value; no error UI replaces the number.
- Optional: an index on `rsvps(attending)` — trivial at ~200 invites, one line in the migration.

## D5. Admin surface for caps + visibility

`api/admin/[token]/invites.ts` is extended (same token guard): `POST` accepts optional `maxPartySize` (default 1); `GET` returns `maxPartySize` and, when present, each invite's `attending`/`partySize` (left join). This gives the couple the cap-setting write path and a headcount read path; the proposal non-goal remains "no dashboard UI". If the couple later _lowers_ an invite's cap below a stored response's party size, the stored row still counts until the guest re-submits (documented, accepted — the couple would handle it directly).

## D6. Land order and shared venue copy

`venue-map-routes/tasks.md` 4.1 already decided: **rsvp-live-count lands FIRST**, owns the venue-name line and RSVP block; the map inserts its own section immediately above and renders no venue line of its own. To make "single source" enforceable, `src/lib/venue.ts` exports `VENUE_NAME = "Graha 58 Gedung Serbaguna UMS"` and `VENUE_CITY = "Surakarta, Central Java"`; `venue-map-routes` will import the same constant when it lands. The "Formal Invitation to Follow" footer copy is preserved unchanged.

## D7. FAQ reconciliation (copy-only)

Two live FAQ claims contradict the shipped behavior and are reworded:

1. "…we won't be able to accept late RSVPs" → softened to ask guests to respond by the deadline (no hard "won't be able"); hard cutoff enforcement stays a possible later change.
2. "When you RSVP, you will see exactly who is invited" → reworded to "you'll confirm for your party" — matching the display-name + stepper UI. (Per-person invite names are a possible later schema extension, not promised now.)

The RSVP deadline _date_ itself stays untouched — it already awaits couple confirmation (`invite-only-personalization` task 4.4).

## D8. Testing strategy (follows repo convention)

`tests/welcome-gate.spec.ts` documents the deliberate convention: the dev server boots against a scratch DB with **no seeding**, and the server contract is verified via curl against a controlled build. This change follows it:

- **curl script** (task 2.5, extended): all identity/error/upsert/count cases including the invite-cookie submit flow and the authenticate-before-parse ordering probe.
- **Playwright**: anonymous markup (no controls, no `/api/rsvp` request), roll-on-scroll, mocked poll roll (intercept `/api/rsvp/count` with changing values), reduced-motion instant swap. The authenticated UI flow is _also_ coverable cheaply because controls are SSR'd: intercept the invite lookup at the route level is not needed — assert anonymous vs. no-JS markup and leave authed rendering to the curl-level contract. No test-DB seeding infrastructure is introduced.
