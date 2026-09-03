# Tasks: public-wall

## 1. API

- [x] 1.1 `GET /api/submissions`: anonymous callers receive `{ mine: null, wall }` (200) instead of 404; cookie-holder behavior unchanged; POST stays cookie-gated
- [x] 1.2 `/api/photos/[...key]`: remove the invite gate for GET; success `Cache-Control` → `public, max-age=31536000, immutable`; 404s stay `no-store`

## 2. Client

- [x] 2.1 `submissions-client.ts`: `loadSubmissions()` fetches for everyone; `hasInviteCookie()` retained for add-story surfaces only; update header comments (zero-request guarantee retired)
- [x] 2.2 `guest-rail.ts`: drop the public early-return in `initGuestRailState()`; public renders wall tiles via the existing path; add-story tile stays cookie-gated (SSR + client)
- [x] 2.3 `WishMarquee.astro`: drop the `hasInviteCookie()` early-return in `init()`; public marquee now swaps states via the same payload (empty → demo + CTA, real wishes → real-only)

## 3. SSR

- [x] 3.1 `index.astro`: teaser tiles render only when `!hasAnyGuestPhoto` (same gate as the mocks); update surrounding comments

## 4. Tests

- [x] 4.1 `guest-rail.spec.ts`: public test now expects one submissions request + wall tiles (no cookie); anonymous-404 expectations removed
- [x] 4.2 `wish-marquee.spec.ts`: public test now expects the fetch + demo/CTA state (empty wall) and real-wishes state when the wall is non-empty
- [x] 4.3 `mock-gate-ssr.spec.ts`: extend the seeded-DB assertions to cover teaser retirement in the served HTML (empty → teasers present; seeded → teasers absent), and add an anonymous `GET /api/submissions` assertion (200, `mine: null`)
- [x] 4.4 Add an API-level test: anonymous photo file fetch succeeds with `public` cache headers (route-level, no cookie)
- [x] 4.5 Update any other tests asserting zero public requests / 404 behavior (grep for `toHaveLength(0)`, `not_found`, public 404 assertions)

## 5. Close-out

- [x] 5.1 Reconcile stale statements: `story-rail-mocks` change deltas (public rail "returns to teaser/demo content") superseded by this change; archive order note — `story-rail-mocks` archives first, `public-wall` second
- [x] 5.2 `pnpm check-types` + `pnpm build` clean
- [x] 5.3 Full Playwright suite green (chromium + mobile-chrome)
