## Why

Wedding invitations are overwhelmingly distributed via chat apps (WhatsApp, Instagram DMs) and opened directly on mobile devices (over 95% of traffic). Maintaining desktop-specific media generation, wide layout breakpoint tracks (`md:`), and desktop regression tests adds unnecessary complexity and asset management overhead. Restricting the experience strictly to mobile and intercepting desktop visitors with an elegant QR code gate ensures the intended vertical, touch-driven cinematic experience while focusing layouts and testing exclusively on mobile devices.

## What Changes

- **Desktop QR Gate**: Any viewport $\ge 768\text{px}$ width and $\ge 600\text{px}$ height (tablets and desktops, leaving landscape phones unblocked) will display a dedicated desktop landing screen instructing visitors to view the invitation on their mobile phone, displaying an in-process generated SVG QR code linking to their personalized invitation URL (preserving `/<id>` from the invite cookie).
- **Mobile-Clamped Media Sizing**: Clamp `HERO_SIZES` to `min(280vw, 768px)` and update `HERO_FALLBACK_SRC` to `/wedding_photo.webp` (the 768w master, with matching intrinsic dimensions in `HeroZoom.astro`). The generated candidate ladder `VARIANT_WIDTHS = [390, 768, 1280]` is retained to serve standard mobile and high-DPI Retina mobile phones (Pixel 7 at DPR 2.625, iPhone Pro at DPR 3) without falling through to multi-megabyte masters.
- **Background Media Suppression**: When `DesktopGate` is displayed, client-side preloading of the 3.1 MB soundtrack and collage image promotion are suppressed via an early head `<html data-desktop>` attribute, saving bandwidth for desktop visitors.
- **Desktop CSS Purge (`md:`)**: Remove unnecessary `md:` layout breakpoints and multi-column desktop structures across `TimelineScroll`, `EventTimes`, `HeroZoom`, `RsvpSection`, and `index.astro`. The `sm:` (640px) utility classes remain active for the 640px–767px mobile band.
- **Mobile-Focused Test Strategy**: Focus Playwright suites on mobile viewports (`Pixel 7`, `iPhone 14`), isolate desktop gate verification into a dedicated test project (`desktop-gate`), re-base existing wide-viewport component tests and `browser.newContext()` calls to mobile viewports, and re-pin non-touch dismissal tests to ungated viewports.

## Capabilities

### New Capabilities

- `desktop-gate`: Intercepts desktop and tablet viewports ($\ge 768\text{px}$ width and $\ge 600\text{px}$ height) with a dedicated mobile-only screen displaying an in-process rendered SVG QR code encoding the personalized invitation URL, guiding guests to open it on their smartphone with accessibility (`role="dialog"`, `aria-modal="true"`, background `inert`).

### Modified Capabilities

- `responsive-media`: Clamps hero `sizes` to `min(280vw, 768px)` and updates hero fallback references and declared intrinsic dimensions to the 768w master.
- `welcome-gate`: Documents that on desktop viewports ($\ge 768\text{px} \times \ge 600\text{px}$), the welcome gate is superseded by `DesktopGate`, preventing desktop wheel or keydown events from triggering false open metrics or latching scroll locks behind the gate.
- `progressive-enhancement`: Excludes the terminal, CSS-displayed `DesktopGate` from script-dismissal suppression, as it delivers full guidance content without JavaScript.
- `media-tiering`: Documents that parse-time collage promotion and soundtrack preloading are suppressed when `data-desktop` is present on desktop viewports.
- `scroll-motion`: Narrows timeline popped content exit travel reference widths to mobile viewports (~360px–430px).

## Impact

- **Build scripts & media**: `apps/web/src/lib/hero-media.ts` updated; `HERO_FALLBACK_SRC` pointed to `/wedding_photo.webp` and `HeroZoom.astro` dimensions updated to `width="768" height="1376"`.
- **Frontend components**: `apps/web/src/pages/index.astro`, `apps/web/src/components/DesktopGate.astro` (new), `HeroZoom.astro`, `TimelineScroll.astro`, `EventTimes.astro`, `RsvpSection.astro`, and `WelcomeGate.astro`.
- **Dependencies**: `apps/web/package.json` and `pnpm-lock.yaml` add `uqr@^0.1.3` for zero-dependency, in-process SVG QR code generation.
- **Styling**: Scoped component CSS cleaned of `md:` breakpoints; `sm:` retained for 640px–767px mobile screens.
- **Tests**: `apps/web/playwright.config.ts` reconfigured for mobile-first testing with an isolated desktop project for `desktop-gate.spec.ts`; existing wide-viewport tests and `browser.newContext()` invocations re-based to mobile viewports.
