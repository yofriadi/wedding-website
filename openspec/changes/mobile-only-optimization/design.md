# Design: Mobile-Only Optimization & Desktop QR Gate

## Context

The wedding website is designed around vertical mobile storytelling with touch-driven interactions (swipe-to-reveal gate, scroll-scrubbed horizontal timeline, interactive touch cards, floating action buttons). Analysis of real-world wedding invitation traffic indicates >95% of guests access invitations via mobile messaging links (WhatsApp, Instagram). Desktop viewports require maintaining separate breakpoint tracks (`md:`) and testing desktop-specific pointer behaviors.

This change transitions the application to mobile-only:

1. Blocking desktop and tablet visitors ($\ge 768\text{px}$ width and $\ge 600\text{px}$ height) with an elegant QR code gate that preserves personalized invite links.
2. Clamping hero media sizing and fallback declarations to mobile resolutions, while retaining `[390, 768, 1280]` to cleanly serve standard and high-DPI Retina mobile phones.
3. Suppressing heavy background media downloads and collage promotion behind the gate.
4. Purging `md:` desktop layout overrides across key presentation components while retaining `sm:` (640px) for wide mobile screens.
5. Reconfiguring Playwright testing around mobile devices, re-basing wide-viewport test cases, and passing mobile viewports to manual `browser.newContext()` calls.

---

## Technical Decisions

### D1: Desktop QR Gate Architecture (`DesktopGate.astro`)

- **Placement**: Mounted as a top-level sibling in `apps/web/src/pages/index.astro` at `z-[100]` before `<main>`.
- **Viewport Interception Predicate**: Pure CSS media query `@media (min-width: 768px) and (min-height: 600px)`.
  - Requiring `min-height: 600px` ensures handheld smartphones held in landscape orientation (e.g., Pixel 7 at $915 \times 412\text{px}$, iPhone 14 at $844 \times 390\text{px}$) are **not** blocked and can experience the mobile site.
  - Standard tablets in portrait/landscape ($\ge 768 \times \ge 1024\text{px}$) and desktop monitors are intercepted.
- **In-Process SVG QR Generation**:
  - Uses `uqr` (`^0.1.3`, a tiny zero-dependency in-process QR code generator added to `apps/web/package.json`).
  - Rendered as pure server-side inline SVG in Astro frontmatter via `renderSVG(text, options)` and inlined with `set:html`. Zero external API calls, ensuring private invite tokens are never leaked to third parties.
  - Emits `data-qr-target={targetUrl}` on the gate root element for straightforward, decoder-free Playwright test assertions.
- **Target URL Reconstruction**:
  - When an invited guest clicks `/<id>` on desktop, `pages/[id].ts` issues a `302 Found` redirect to `/` and sets the `ww_invite_id` cookie.
  - `DesktopGate` derives the invite ID on the server from `inviteIdFromCookies(Astro.cookies)` (validated with `INVITE_ID_RE`).
  - The public origin is reconstructed using forwarded headers via `firstForwardedValue(Astro.request.headers.get("x-forwarded-proto"))` and `firstForwardedValue(Astro.request.headers.get("x-forwarded-host"))` (exported from `same-origin.ts`), falling back to `Astro.url.origin`.
  - When an invite ID is present, the QR code encodes `${publicOrigin}/${inviteId}`. When anonymous, it encodes `${publicOrigin}/`.
  - Scanning the QR code on a mobile phone navigates to `/<id>`, which sets the cookie on mobile and personalizes the invitation seamlessly.
- **Accessibility, Dynamic Inert, & Background Scroll Lock**:
  - `DesktopGate` carries `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="desktop-gate-heading"`.
  - Client script sets up an `applyInert(matches)` helper: evaluated immediately upon page load and attached to `mql.addEventListener("change", (e) => applyInert(e.matches))`.
  - When matching (`matches === true`):
    - Sets `<html data-desktop>`.
    - Applies `document.documentElement.style.overflow = "hidden"` so wheel scrolling cannot scroll background content.
    - Applies `inert` to `<main>`, `#claim-gate`, and `#welcome-gate`, preventing background elements from trapping focus, receiving clicks, or allowing form submissions.
  - When resized below threshold (`matches === false`):
    - Removes `data-desktop`.
    - Restores `overflow = ""`.
    - Removes `inert` from `<main>`, `#claim-gate`, and `#welcome-gate`.
    - Invokes `WelcomeGate`'s `tryArm()` dynamically so normal mobile arming, gestures, and scroll locks activate.
- **Background Media Suppression**:
  - An early inline `<script>` in the document `<head>` checks `window.matchMedia('(min-width: 768px) and (min-height: 600px)').matches`. If matched, it sets `<html data-desktop>`.
  - In `index.astro`, `enableSoundtrack` and parse-time collage promotion check `data-desktop` and abort.
  - In `ZoomParallax.astro`, `applyTier()` checks `data-desktop`: on desktop viewports, `promoteAll()` and `watchDeferredImages()` are suppressed.
  - In `WelcomeGate.astro`:
    - The inline script checks `data-desktop`: if present, it skips the initial `lockScroll()`, and the `gate-failsafe` handler skips `setMainInert(false)`.
    - In `arm()`, it immediately returns without arming while `data-desktop` is present, preventing desktop wheel/keypress from committing the gate or firing false `POST /api/invite/opened` metrics.

### D2: Media Optimization & Retina Clamping

- **Candidate Ladder Preservation for High-DPI Mobile**:
  - `VARIANT_WIDTHS = [390, 768, 1280]` is retained in `media-candidates.ts` and `generate-media-variants.mjs`.
  - _Retina Mobile Rationale_: Pixel 7 has DPR 2.625, and iPhone Pro has DPR 3. At 390 CSS px, cards in the timeline (`SIZES_CARD` resolves to 340px) demand $340 \times 2.625 \approx 892\text{px}$, and cards in the 640px–767px mobile band (`sm:w-[400px]`) demand $400 \times 2 = 800\text{px}$. Retaining the 1280w rung (which only generates 4 files across the entire repo: `center-focus-w1280` and `keluarga-acik-w1280`) ensures high-DPI mobile phones select `-w1280` rather than falling through to multi-megabyte masters (1920px and 2048px).
- **Hero Sizing, Fallback, & Intrinsic Dimensions**:
  - `HERO_SIZES` in `apps/web/src/lib/hero-media.ts` is clamped from `min(280vw, 1536px)` to `min(280vw, 768px)`.
  - _Underclaim Rationale_: At 390 CSS px, `min(280vw, 768px)` claims 768px against a 1092px scaled presentation under `scale(2.8)`. DPR-1 devices select the 768w master, while Retina DPR-2 devices select the 1536w candidate.
  - `HERO_FALLBACK_SRC` is updated from `/wedding_photo-1024.webp` to `/wedding_photo.webp` (the 768w master).
  - In `HeroZoom.astro`, `<img width="1024" height="1835">` is updated to `<img width="768" height="1376">` matching the master file's true intrinsic dimensions.
  - In `TimelineScroll.astro`, `SIZES_PORTRAIT` and `SIZES_CARD` are updated to remove `(min-width: 768px)` queries.

### D3: Single-Track Mobile CSS Purge (`md:`)

- Purge `md:` utilities ($\ge 768\text{px}$) from key presentation components, while leaving `sm:` (640px) intact for larger mobile phones and foldables (640px–767px band):
  - `EventTimes.astro`: remove `md:py-16`, `md:mb-14`, `md:text-4xl`, `md:gap-8`, `md:h-[245px]`, `md:text-5xl`, `md:text-3xl`, `md:text-xl`.
  - `TimelineScroll.astro`: remove `md:text-6xl`, `md:w-[560px]`, `md:h-[480px]`, `md:w-[340px]`, `md:h-[420px]`.
  - `HeroZoom.astro`: remove `md:space-y-32`, `md:gap-x-2`.
  - `RsvpSection.astro`: remove `md:text-7xl`.
  - `pages/index.astro`: remove `md:pt-16`, `md:mb-8`, `md:text-4xl`, `md:py-16`.
- _Retained Classes in Ancillary Components_: `VenueMap.astro` retains `md:h-[720px]`, `WeddingFAQ.astro` retains its `md:` layout, and `WelcomeGate.astro` retains internal typography classes for ungated short windows and desktop gate presentation.

### D4: Mobile-First Testing Strategy

- `apps/web/playwright.config.ts`:
  - Reconfigure default `chromium` to a standard mobile viewport: `use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } }`, `testIgnore: /desktop-gate/`. Both `chromium` and `mobile-chrome` are retained because specific tests (such as CDP network throttling and offline emulation in `media-tiering.spec.ts`) require desktop Chromium semantics (`isMobile: false`) while running in a mobile viewport.
  - Retain `mobile-chrome` (`devices["Pixel 7"]`, `testIgnore: /desktop-gate/`).
  - Reconfigure `webkit` from `Desktop Safari` to a mobile profile (`devices["iPhone 14"]`, viewport 390x844), retaining `testIgnore: /^(?!.*media-tiering)/` so media-tiering WebKit tests execute on a mobile viewport.
  - Add a dedicated `desktop-gate` project with viewport $1280 \times 720$ running exclusively against `tests/desktop-gate.spec.ts` (`testMatch: /desktop-gate/`).
- **Re-Basing Wide-Viewport Specs & `browser.newContext()` Invocations**:
  - Pass `{ viewport: { width: 390, height: 844 } }` to `browser.newContext()` in `group-invitations.spec.ts:933, 934, 1187`, `claim-member-gate.spec.ts:262, 608`, `resilient-media-delivery.spec.ts:148`, `scroll-fade.spec.ts:84`, and `venue-map.spec.ts:133` so they do not inherit the default 1280x720 desktop viewport and hit `DesktopGate`.
  - In `resilient-media-delivery.spec.ts`, delete the wide leg (`:98-141`) and its `expect(wideAcikSrc).not.toBe(mobileAcikSrc)` assertion, and clean up `mobileAcikSrc`.
  - In `families-reveal.spec.ts:124, 416`, re-base viewport to mobile (`390x844`).
  - In `magnetic-image-trail.spec.ts:41`, drop the 1440 iteration and rename test to drop "on desktop".
  - In `families-reveal-wave-motion.spec.ts:50`, re-base viewport to `{ width: 400, height: 844 }` (a distinct width ensuring the resize re-init triggers).
  - In `venue-map-interactions.spec.ts:316-327`, re-pin with `test.use({ viewport: { width: 1024, height: 500 } })`.
- **Re-Pinning WelcomeGate Wheel Test**:
  - Re-pin `test("desktop wheel dismisses the gate without firing the metric")` in `welcome-gate.spec.ts` inside a dedicated `test.describe` with `test.use({ viewport: { width: 1024, height: 500 } })`.
- **Verification Command**:
  - `pnpm run check-types && pnpm --filter web exec playwright test && pnpm run build`.

---

## Risks and Mitigations

| Risk                                                  | Mitigation                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tablet visitors ($\ge 768\text{px}$) blocked          | Accepted product trade-off. The wedding experience is designed exclusively for handheld mobile portrait viewports. The QR code makes mobile handoff instant.          |
| Landscape phones unintentionally blocked              | Solved by qualifying the gate media query with `(min-height: 600px)`. Handheld landscape phones are $\le 430\text{px}$ tall and stay unblocked.                       |
| Short desktop windows ($< 600\text{px}$ tall) ungated | Accepted trade-off. Desktop windows below 600px render the mobile layout at wide window width; keeping the height qualifier is what protects landscape mobile phones. |
| QR scan loses invite identity                         | Solved by server-side cookie resolution (`ww_invite_id`) reconstructing the public `/${inviteId}` URL using forwarded headers.                                        |
| Group slot burned behind desktop gate                 | Solved by marking `#claim-gate` as `inert` alongside `<main>` and `#welcome-gate`.                                                                                    |
| Desktop visitors download heavy background media      | Solved by head script setting `<html data-desktop>` and suppressing audio preloading, collage promotion, and WelcomeGate failsafe.                                    |
| High-DPI mobile screens fall through to master        | Solved by retaining `1280` in `VARIANT_WIDTHS`, cleanly serving Pixel 7 (@2.625x) and iPhone Pro (@3x) with optimized variants.                                       |
