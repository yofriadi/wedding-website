# Implementation Tasks: Mobile-Only Optimization

## 1. Desktop Gate & Viewport Interception

- [x] 1.1 Add `uqr@^0.1.3` dependency to `apps/web/package.json`, execute `pnpm install`, and commit `pnpm-lock.yaml`.
- [x] 1.2 Create `apps/web/src/components/DesktopGate.astro`:
  - Enforce `@media (min-width: 768px) and (min-height: 600px)` display rule so desktop/tablets are intercepted while landscape phones ($\le 430\text{px}$ height) remain unblocked.
  - Render an elegant card with couple monogram, QR code generated via `uqr`'s `renderSVG(text, options)` and inlined with `set:html`, and guidance copy.
  - Emit `data-qr-target={targetUrl}` on the gate root element for test verification.
  - Declare `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="desktop-gate-heading"`.
- [x] 1.3 Personalization preservation in QR code:
  - Export `firstForwardedValue` from `apps/web/src/lib/same-origin.ts`.
  - Derive invite token on the server using `inviteIdFromCookies(Astro.cookies)` and validate against `INVITE_ID_RE`.
  - Reconstruct public origin from `x-forwarded-proto` and `x-forwarded-host` headers using `firstForwardedValue`, falling back to `Astro.url.origin`.
  - Encode `${origin}/${inviteId}` when invite token is present, and `${origin}/` when anonymous.
- [x] 1.4 Mount `DesktopGate` in `apps/web/src/pages/index.astro` as a top-level sibling before `<main>` at `z-[100]`:
  - Add early head script to set `<html data-desktop>` when matching `(min-width: 768px) and (min-height: 600px)`.
  - Implement an `applyInert(matches)` helper: evaluate immediately on initial load, and attach to `matchMedia('(min-width: 768px) and (min-height: 600px)').addEventListener('change', (e) => applyInert(e.matches))`.
  - When matching (`matches === true`):
    - Set `<html data-desktop>`.
    - Apply `document.documentElement.style.overflow = "hidden"` to prevent background scrolling behind the gate.
    - Apply `inert` to `<main>`, `#claim-gate`, and `#welcome-gate`.
  - When not matching (`matches === false`):
    - Remove `<html data-desktop>`.
    - Restore `document.documentElement.style.overflow = ""`.
    - Remove `inert` from `<main>`, `#claim-gate`, and `#welcome-gate`.
    - Call `WelcomeGate.astro`'s `tryArm()` to dynamically activate mobile arming, gestures, and scroll locks.
- [x] 1.5 Suppress background media and welcome gate arming on desktop viewports:
  - In `index.astro`, guard `enableSoundtrack` and inline collage promotion with `if (document.documentElement.hasAttribute('data-desktop')) return;`.
  - In `ZoomParallax.astro`, guard `applyTier()` so `promoteAll()` and `watchDeferredImages()` are suppressed when `data-desktop` is set.
  - In `WelcomeGate.astro`:
    - Skip the initial `lockScroll()` call while `data-desktop` is set.
    - Guard the `gate-failsafe` handler so that if `data-desktop` is set, it does not strip `inert`.
    - Guard `arm()` to early return if `data-desktop` is present, preventing desktop wheel/keypress from committing reveal or firing false `POST /api/invite/opened` metrics.

## 2. Media Optimization & Retina Clamping

- [x] 2.1 Update `apps/web/src/lib/hero-media.ts`:
  - Clamp `HERO_SIZES = "min(280vw, 768px)"`.
  - Update `HERO_FALLBACK_SRC = "/wedding_photo.webp"`.
  - Update documentation comments to reflect mobile-only sizes and underclaim rationale.
- [x] 2.2 Update `apps/web/src/components/HeroZoom.astro`:
  - Update fallback image dimensions to `width="768" height="1376"` to match the master asset.
- [x] 2.3 Clamp `sizes` attributes for wide component slots:
  - In `apps/web/src/components/TimelineScroll.astro`, update `SIZES_PORTRAIT` and `SIZES_CARD` to remove `(min-width: 768px)` queries, and update adjacent documentation comments.

## 3. Single-Track Mobile CSS Purge (`md:`)

- [x] 3.1 Purge `md:` responsive classes in `apps/web/src/components/TimelineScroll.astro`:
  - Remove `md:text-6xl`, `md:w-[560px]`, `md:h-[480px]`, `md:w-[340px]`, `md:h-[420px]`.
- [x] 3.2 Purge `md:` responsive classes in `apps/web/src/components/EventTimes.astro`:
  - Remove `md:py-16`, `md:mb-14`, `md:text-4xl`, `md:gap-8`, `md:h-[245px]`, `md:text-5xl`, `md:text-3xl`, `md:text-xl`.
- [x] 3.3 Purge `md:` responsive classes in `apps/web/src/components/HeroZoom.astro`:
  - Remove `md:space-y-32` and `md:gap-x-2`.
- [x] 3.4 Purge `md:` responsive classes in `apps/web/src/components/RsvpSection.astro` (`md:text-7xl`) and `apps/web/src/pages/index.astro` (`md:pt-16`, `md:mb-8`, `md:text-4xl`, `md:py-16`).

## 4. Mobile-First Testing Suite & Verification

- [x] 4.1 Update `apps/web/playwright.config.ts`:
  - Reconfigure default `chromium` project to a standard mobile viewport: `use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } }`, `testIgnore: /desktop-gate/`.
  - Retain `mobile-chrome` (`devices["Pixel 7"]`, `testIgnore: /desktop-gate/`).
  - Reconfigure `webkit` project to a mobile Safari profile (`devices["iPhone 14"]`, viewport 390x844, retaining `testIgnore: /^(?!.*media-tiering)/`).
  - Add dedicated `desktop-gate` project with viewport $1280 \times 720$ scoped to `testMatch: /desktop-gate/`.
- [x] 4.2 Re-base wide-viewport component tests and `browser.newContext()` calls:
  - Add `{ viewport: { width: 390, height: 844 } }` to `browser.newContext()` invocations in `apps/web/tests/group-invitations.spec.ts:933, 934, 1187`, `apps/web/tests/claim-member-gate.spec.ts:262, 608`, `apps/web/tests/resilient-media-delivery.spec.ts:148`, `apps/web/tests/scroll-fade.spec.ts:84`, and `apps/web/tests/venue-map.spec.ts:133`.
  - In `apps/web/tests/resilient-media-delivery.spec.ts`, delete the wide leg (`:98-141`) and its `expect(wideAcikSrc).not.toBe(mobileAcikSrc)` assertion, and clean up the unused `mobileAcikSrc` binding.
  - In `apps/web/tests/families-reveal.spec.ts:124, 416`, re-base viewport to mobile (`390x844`).
  - In `apps/web/tests/magnetic-image-trail.spec.ts:41`, drop the 1440 iteration and rename test to drop "on desktop".
  - In `apps/web/tests/families-reveal-wave-motion.spec.ts:50`, re-base viewport to `{ width: 400, height: 844 }`.
  - In `apps/web/tests/venue-map-interactions.spec.ts:316-327`, re-pin with `test.use({ viewport: { width: 1024, height: 500 } })`.
- [x] 4.3 Create `apps/web/tests/desktop-gate.spec.ts`:
  - Assert `DesktopGate` is visible on $1280 \times 720$ and `data-qr-target` matches expected URL.
  - Assert `DesktopGate` is hidden on $412 \times 915$ and landscape $915 \times 412$.
  - Assert `<main>`, `#welcome-gate`, and `#claim-gate` (if present) carry `inert` when gate is displayed; on resize below threshold, assert `#welcome-gate` loses `inert` while `<main>` retains `inert` until welcome gate exit (and loses `inert` when `#welcome-gate` is absent).
  - Assert no `.mp3` requests are made and collage images remain unpromoted while gate is displayed.
  - Assert QR target encodes `${origin}/${inviteId}` when invite cookie is present, and root when anonymous.
- [x] 4.4 Update `apps/web/tests/welcome-gate.spec.ts`:
  - Wrap `test("desktop wheel dismisses the gate without firing the metric")` inside a scoped `test.describe` with `test.use({ viewport: { width: 1024, height: 500 } })`.
- [x] 4.5 Run verification contract:
  - Execute `pnpm run check-types`.
  - Execute `pnpm --filter web exec playwright test`.
  - Execute `pnpm run build`.
