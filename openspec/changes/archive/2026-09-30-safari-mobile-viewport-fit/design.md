## Context

On mobile devices, particularly iOS Safari, the browser chrome (URL/search bar at the top or bottom, and the navigation toolbar at the bottom) dynamically expands and collapses based on user scroll gestures:

```
[Page at rest / Top of page]          [User scrolling downward]
+--------------------------------+    +--------------------------------+
| Status bar + Full URL bar      |    | Status bar + Compact URL pill  |
+--------------------------------+    +--------------------------------+
|                                |    |                                |
| Visible viewport:              |    | Visible viewport:              |
| 100svh (Small Viewport)        |    | 100lvh (Large Viewport)        |
|                                |    | (~60-80px taller than svh)     |
|                                |    |                                |
+--------------------------------+    |                                |
| Bottom navigation bar          |    |                                |
+--------------------------------+    +--------------------------------+
```

### The Three Viewport Height Units in CSS Values and Units Module Level 4:

1. **`svh` (Small Viewport Height)**: Defined as the viewport height when all dynamic browser chrome elements are **fully expanded**.
2. **`lvh` (Large Viewport Height)**: Defined as the viewport height when all dynamic browser chrome elements are **fully retracted/hidden**.
3. **`dvh` (Dynamic Viewport Height)**: Tracks the active visible height dynamically as chrome animates in and out.
4. **`vh` (Legacy Viewport Height)**: In WebKit (Safari), `100vh` was historically pinned to the large viewport (`100lvh`) to prevent jarring layout recalculations on scroll. (On Android Chromium/Firefox, legacy `vh` tracks closer to the small/dynamic viewport).

### The Desktop vs. Mobile Safari Disparity

- **Safari Desktop**: Has no collapsible chrome. `100svh`, `100lvh`, `100dvh`, and `100vh` all evaluate to identical pixel values.
- **Headless & Emulated Browsers**: Standard DevTools device emulation (e.g. Chrome DevTools device mode, Playwright's mobile viewport emulation) does not simulate collapsing address bars. Consequently, `svh === lvh === dvh` in automated testing unless explicitly driven on real hardware or WebKit simulators with dynamic chrome enabled.
- **Safari Mobile in Production**: As a visitor scrolls through the document, the address bar collapses within the first ~50px of scroll. By the time the user reaches sections below the fold (e.g. `FamiliesReveal`, `ZoomParallax`, `TimelineScroll`), browser chrome is completely retracted. Sizing a pinned stage to `100svh` leaves the stage ~60–80px short of the bottom edge, exposing a visible stripe of underlying canvas.

## Goals / Non-Goals

**Goals:**

- Guarantee seamless full-viewport coverage for all scroll-driven and pinned sections on Mobile Safari.
- Establish an authoritative standard for viewport units across CSS styles and JavaScript calculations.
- Eliminate visual bottom gaps, layout flickering, and scrub jumps during forward and reverse scrolling.
- Reconcile `openspec/specs/scroll-motion/spec.md` so that the specification reflects the shipped `lvh` architecture.
- Provide clear verification criteria for automated CI tests and physical iOS Safari validation.

**Non-Goals:**

- Changing section visual designs, pacing, typography, or animation keyframe distributions.
- Attempting to force Mobile Safari's chrome to stay permanently expanded or permanently collapsed via invasive scroll hacks (e.g. `position: fixed` page wrappers with fake scrolling).

## Decisions

### D1 — Pinned stages and scroll runways MUST use `lvh` with a `vh` fallback

- **Decision**: All scroll runways (e.g., `height: 400lvh`) and sticky stages (e.g., `height: 100lvh`) must declare the standard fallback pair:
  ```css
  height: 100vh;
  height: 100lvh;
  ```
- **Rationale**:
  - Pinned sequences are watched _while scrolling_, which is precisely the state in which mobile browser chrome is retracted.
  - Sizing to `100lvh` matches the physical visible area during the entire scroll run.
  - The preceding `100vh` declaration provides fallback for older engines or legacy webviews lacking CSS Values Level 4 support (and in iOS WebKit, legacy `vh` resolves to the large viewport by default).

### D2 — Pre-scroll static overlays use `fixed inset-0` or `svh`

- **Decision**: Pre-scroll overlays (like `WelcomeGate`, `DesktopGate`, and `#loading-screen`) use `fixed inset-0`, which binds to the layout viewport at rest. Where explicit height units are required on pre-scroll elements, `svh` is reserved so content avoids clipping under the bottom tab bar prior to user scroll.
- **Rationale**: When the page is first loaded, browser chrome is fully expanded. Once scroll begins, `lvh` governs all pinned and scroll-driven stages.

### D3 — Prohibit `dvh` for pinned runways and scrub geometry (Carve-out: Viewport-Tracking UI)

- **Decision**: `dvh` is forbidden in all pinned stages, runways, and scroll scrub calculations.
- **Carve-out**: Non-scrub, viewport-tracking interactive controls (such as `AddImageButton.astro:77`'s `top: calc(100dvh - var(--cta-bottom) - 3.5rem);` with `--cta-bottom: max(1.5rem, env(safe-area-inset-bottom));`) MAY use `dvh` because their express purpose is to remain pinned directly above the dynamic Safari toolbar as chrome moves, rather than driving a scroll animation.
- **Rationale**: For scroll runways (e.g., `1249dvh`), dynamic re-resolution mid-scroll continuously shifts total travel distance, causing scrub progress (`scrollY / travel`) to jump or stutter.

### D4 — Measure JS geometry against static DOM elements, not `window.innerHeight`

- **Decision**: JavaScript calculations that determine stage bounds, cover scaling, or travel must measure against the stage element itself (`stage.getBoundingClientRect()`) or a static probe (`measureLvh()`), rather than `window.innerHeight`.
- **Rationale**: In Mobile Safari, `window.innerHeight` behaves like `dvh`—it changes as the toolbar collapses. Measuring against the DOM stage (which is locked to `100lvh`) ensures consistent scale factors and prevents mid-scroll jumps.
- **Carve-out**: Approach observers (e.g. `media-tiering` approach margins) and viewport in-view fade triggers (e.g. `scroll-fade.ts`, `photo-trail.ts`) may use `window.innerHeight` because their role is to detect when content enters the visible screen, which is naturally dynamic.

### D5 — Reconcile `scroll-motion` specification

- **Decision**: Correct the delta specification in `openspec/specs/scroll-motion/spec.md`:
  - Update `Requirement: Pinned stages are sized to the chrome-hidden viewport` to include `TimelineScroll` under `lvh`.
  - Update `Requirement: Timeline node spacing is widened with the runway growing at constant pan speed` from `1249svh` to `1249lvh` across its description and all canonical scenarios.
  - Harmonize requirement scenarios so they explicitly validate the absence of bottom gaps on mobile browsers with retracted chrome.

## Risks / Trade-offs

- **[Trade-off] Top Hero at Rest**: Sizing `HeroZoom` to `100lvh` means that before the visitor begins their very first scroll, the bottom ~60–80px of the stage sits slightly below the bottom toolbar fold.
  - _Mitigation_: The Hero design centers its focal point and typography well within the safe area. As soon as the visitor swipes up or scrolls by 20px, chrome retracts and the stage fills the screen perfectly. This trade-off is far superior to having a 70px gap during the remaining 300lvh of pinned zoom animation.
- **[Risk] Test Emulation False Positives**: Automated headless tests cannot physically retract browser chrome.
  - _Mitigation_: Automated tests validate CSS rule declarations (`cssText` must contain `lvh` and must not contain `svh`/`dvh` for pinned stages), complemented by a documented manual QA pass on physical iOS devices.
