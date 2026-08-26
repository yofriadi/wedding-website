# Tasks: swipe-gate-reveal

## 1. Schema + open-metric endpoint

- [x] 1.1 Add `openedAt` (`opened_at`, nullable int) and `openedCount` (`opened_count`, not null, default 0) to `packages/db/src/schema/invites.ts`; generate a committed migration (`pnpm db:generate`); apply locally (`db:migrate` for disposable DBs per repo convention)
- [x] 1.2 Create `apps/web/src/pages/api/invite/opened.ts`: `POST` reads `ww_invite_id` cookie → bump `opened_at`/`opened_count` → `204`; absent/malformed/unknown cookie → uniform bare `404`; `Cache-Control: no-store` on all responses; DB failure logs and still returns `204` (mirror `apps/web/src/pages/[id].ts` best-effort pattern); no request-body parsing needed
- [x] 1.3 Verify with curl: valid cookie bumps both fields (repeated calls accumulate); no-cookie/malformed/unknown all return identical `404` shape; `no-store` present on success and error; no id accepted via path/query [Verified against standalone build: 204 + accumulation 1→2→3, uniform empty-body 404s, no-store on all, query-param ids ignored. Note: bare curl POST trips Astro's CSRF guard — the browser-like no-body/no-content-type POST passes, matching the gate client.]

## 2. Admin read side

- [x] 2.1 Add `GET` to `apps/web/src/pages/api/admin/[token]/invites.ts` (same constant-time token check, same bare `404`): return all invites with `display_name`, `seen_at`, `seen_count`, `opened_at`, `opened_count`; `no-store`
- [x] 2.2 Verify: correct token returns rows incl. open metrics; wrong/missing token → identical `404` as POST [Verified via curl: 200 rows include openedAt/openedCount; wrong/missing token → same bare no-store 404 as POST.]

## 3. WelcomeGate component

- [x] 3.1 Create `apps/web/src/components/WelcomeGate.astro`: fixed inset-0 surface, z below `#loading-screen` (z-50) and above hero; background layer with designated-image slot (exists-check like story teasers: probe `public/` dev + `dist/client/` build) over a light neutral fallback; centered `#gate-greeting` element rendering the `displayName` prop verbatim (Astro auto-escapes); bottom-pinned shimmer hint via `TextShimmer` (static phrase, e.g. "Swipe up to open") [Slot path `/gate/gate-bg.webp`; light ivory fallback ships until the couple supplies the image. Shimmer retinted for the light surface.]
- [x] 3.2 In `index.astro`: pass `inviteDisplayName` into `<WelcomeGate />`; REMOVE `#invite-greeting` from `#loading-screen` (reverts to phrases-only); keep the SSR cookie lookup and `Cache-Control: no-store` untouched
- [x] 3.3 Verify SSR: invited → name present in gate markup in the raw HTML response, absent from loader markup; anonymous → empty greeting element, hint only; HTML is `no-store` [Verified against standalone build: invited HTML contains the name exactly once, inside `#gate-greeting`; loader markup is phrases-only; anonymous HTML has an empty greeting element and no names; `no-store` on both.]

## 4. Gesture + choreography (inline script)

- [x] 4.1 Inline (`is:inline`) gate script in `index.astro` or the component: scroll-lock body from first paint (`overflow: hidden` + gate `touch-action: none`); `touchstart`/`touchmove` (non-passive, `preventDefault`)/`touchend` tracking with 1:1 upward `translateY`, downward clamp at 0
- [x] 4.2 Commit logic: release beyond ~28% viewport height OR upward flick velocity (~0.5 px/ms) commits → animate `translateY(-100%)` (~400ms ease-out, transform-only) → on `transitionend` remove gate from DOM + unlock scroll; otherwise spring back (~250ms ease-out) and stay armed
- [x] 4.3 On commit: call `startMusic()` synchronously inside the committing `touchend`; fire the open metric — one fire-and-forget `fetch("/api/invite/opened", { method: "POST", keepalive: true })`, only when `document.cookie` contains `ww_invite_id`, once per pageview
- [x] 4.4 Desktop dismissal without physics: `wheel`/`click`/`keydown` while armed commits the reveal (plain slide-up); note wheel carries no user activation → music stays on the existing armed-gesture fallback for desktop
- [x] 4.5 Playwright: real `touchscreen` drag past threshold → gate gone, `scrollY` unlocked, `hero-music` `paused === false` in a fresh (autoplay-blocked) context, exactly one POST observed; short drag → springs back, still armed; repeat swipe doesn't re-fire the POST [All asserted in tests/welcome-gate.spec.ts; CDP touchscreen drag used (Playwright's touchscreen API only taps). The NotAllowedError console line in output is the pre-gesture blocked-autoplay the test asserts on.]

## 5. Escape hatches

- [x] 5.1 `@media (scripting: none)` hides the gate entirely [Verified via `javaScriptEnabled:false` Playwright context → gate SSR'd but `display:none`.]
- [x] 5.2 CSS failsafe: gate auto-dismisses after ~15s via a pure-CSS animation; the inline script cancels it the moment the gesture arms successfully [`animation: gate-failsafe 600ms 15s forwards` present in built CSS; Playwright asserts no `gate-failsafe` animation running once armed.]
- [x] 5.3 `prefers-reduced-motion`: no tracking, no slide — first tap/click/key dismisses instantly; scroll lock still applies until dismissal [Playwright `reducedMotion:reduce`: click removes the gate with no translateY slide; scroll unlocks after.]
- [ ] 5.4 Real-device pass (iOS Safari + Android Chrome): no scroll chaining/rubber-band leak while armed; spring-back feels right; music starts on the reveal swipe

## 6. Close-out

- [x] 6.1 Throttled-network regression check (Slow 3G): loader → gate → swipe → hero sequence is deterministic; no mid-timeline landing; no gate/loader deadlock (loader still hides without gate JS) [Playwright CDP `emulateNetworkConditions` (~1 MB/s, 300ms latency): scroll locked at 0 from first paint, loader hides on its own media readiness and reveals the gate, scroll still 0 post-reveal. NOTE: emulated-throttle proxy, not a physical Slow 3G device soak — see 5.4.]
- [x] 6.2 Confirm anonymous HTML contains no names anywhere; invited HTML contains exactly one (in the gate) [Verified against standalone build with a distinctive seeded name: invited → exactly one occurrence, inside `#gate-greeting`; anonymous → zero occurrences.]
- [ ] 6.3 Confirm the production migration runs BEFORE server start on deploy (same discipline as `invite-only-personalization` task 1.9)
- [ ] 6.4 Archive order: archive `invite-only-personalization` BEFORE this change so the `guest-greeting` MODIFIED delta has its base
