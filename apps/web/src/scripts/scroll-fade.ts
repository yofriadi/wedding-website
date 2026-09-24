/**
 * Bidirectional scroll-driven fade & slide animation.
 *
 * Smoothly fades in and slides up elements as they enter the viewport from the bottom,
 * and smoothly reverses back out when scrolling back up or past the top.
 * Honors prefers-reduced-motion.
 *
 * Frame discipline (two passes, never interleaved): every element's rect is
 * READ first, then every element's style is WRITTEN. Reading a rect after a
 * write forces the browser to flush the pending style change to answer the
 * geometry question, so a read/write/read/write loop over N elements costs N
 * synchronous layouts per scroll frame. Split, it costs one.
 *
 * `will-change` is rented, not owned: it is set while an element is mid-travel
 * and cleared once it settles at either end, so the page does not hold a
 * compositor layer per faded element for the rest of the session (the same
 * hint-release discipline the retired QuranVerse reveal was held to).
 *
 * VISIBILITY FLOOR (progressive-enhancement: "Scroll-driven reveals never hide
 * unanimated content"). This module is the only thing that ever reduces a
 * participant's opacity, and it does so exclusively from `onScroll`'s measured
 * pass — `initScrollFade` writes opacity only in its reduced-motion branch, and
 * writes 1 there. Three consequences, all load-bearing:
 *
 *   - Delivered markup AND the initial computed style are opacity 1. Nothing in
 *     `src/` sets `[data-scroll-fade]` below 1; the only rule in the codebase
 *     that touches the attribute is the `prefers-reduced-motion` block in
 *     `src/styles/global.css`, and it sets `opacity: 1 !important`.
 *   - A script that never runs, runs late, or throws therefore leaves content
 *     VISIBLE. `onScroll` darkens only what it has itself measured as outside
 *     the reveal window, so a late animation is a strictly better failure than
 *     invisible content.
 *   - A future CSS rule that hides participants pre-reveal breaks this floor.
 *     Task 3.6 is to add a no-script regression case in
 *     `tests/scroll-fade.spec.ts` that fails if one is ever added. It has not
 *     been written: 3.6 is deferred to the testing pass, so until it lands this
 *     floor is documented and unguarded. Do not read this comment as a claim
 *     that a test covers it.
 *
 * THE BOUNDARY, precisely — and it is NOT "everything in the viewport stays at
 * 1", which is false. An element is FULLY entered when
 * `rect.top <= vh - enterThreshold` (`enterThreshold` in `computeFrame` below):
 * that is where `enterProgress` reaches 1 and the element holds opacity 1. An
 * element inside the bottom `enterThreshold` band — 160px, or 240px for
 * `data-scroll-fade="card"` — is PARTIALLY entered and legitimately computes
 * below 1. At `vh` 844 and `rect.top` 800, `enterProgress` is 0.275 and the
 * eased opacity is ≈0.185 while `exitProgress` is still 1. Every assertion
 * about this floor must be scoped to fully-entered elements.
 *
 * Today all nine participants sit far below the initial fold, so "no flash on
 * first paint" holds VACUOUSLY — nothing is near the boundary to test it. A
 * future participant placed near the fold must respect that band rather than
 * assume it is exempt.
 */

interface FadeTarget {
  el: HTMLElement;
  isCard: boolean;
  /** Tracks the last written hint so settling clears it exactly once. */
  hinted: boolean;
}

let targets: FadeTarget[] = [];
let listenersAttached = false;
let ticking = false;

interface FadeFrame {
  target: FadeTarget;
  opacity: number;
  y: number;
}

/** Pure geometry → visual state. No DOM writes, so it is safe in the read pass. */
function computeFrame(target: FadeTarget, rect: DOMRect, vh: number): FadeFrame {
  const { isCard } = target;

  // Bottom enter threshold:
  // When rect.top >= vh, it hasn't entered (enterProgress = 0).
  // When rect.top <= vh - enterThreshold, it has fully entered (enterProgress = 1).
  //
  // That second line IS the visibility floor's boundary (see the module header):
  // fully-entered elements hold opacity 1, elements still inside this band are
  // partially entered and may legitimately compute below it.
  const enterThreshold = Math.min(vh * 0.32, isCard ? 240 : 160);
  const enterTravel = vh - rect.top;
  const enterProgress = Math.min(1, Math.max(0, enterTravel / enterThreshold));
  const easedEnter = enterProgress * enterProgress * (3 - 2 * enterProgress);

  // Top exit threshold:
  // When rect.bottom >= exitThreshold, it is fully in view (exitProgress = 1).
  // When rect.bottom <= 0, it has scrolled past the top (exitProgress = 0).
  const exitThreshold = Math.min(vh * 0.28, isCard ? 200 : 120);
  const exitProgress = Math.min(1, Math.max(0, rect.bottom / exitThreshold));
  const easedExit = exitProgress * exitProgress * (3 - 2 * exitProgress);

  // Opacity is the minimum of enter and exit progress
  const opacity = Math.min(easedEnter, easedExit);

  // Vertical translation: translates up on entrance, settles at 0,
  // and translates upward on exit.
  const maxOffsetDown = isCard ? 45 : 30;
  const maxOffsetUp = isCard ? 20 : 15;
  const y = (1 - easedEnter) * maxOffsetDown - (1 - easedExit) * maxOffsetUp;

  return { target, opacity, y };
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const vh = window.innerHeight;

    // Pass 1 — read every rect. No writes in this loop.
    const frames: FadeFrame[] = targets.map((target) =>
      computeFrame(target, target.el.getBoundingClientRect(), vh),
    );

    // Pass 2 — write. Layout is already settled, so none of these flush it.
    for (const { target, opacity, y } of frames) {
      const { el } = target;
      el.style.opacity = opacity.toFixed(4);
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;

      // Mid-travel elements keep the hint; settled ones give their layer back.
      const moving = y !== 0 && opacity > 0;
      if (moving !== target.hinted) {
        el.style.willChange = moving ? "transform, opacity" : "auto";
        target.hinted = moving;
      }
    }
  });
}

export function initScrollFade() {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-fade]"));
  if (elements.length === 0) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    targets = [];
    for (const el of elements) {
      el.style.opacity = "1";
      el.style.transform = "none";
      el.style.willChange = "auto";
    }
    return;
  }

  targets = elements.map((el) => ({
    el,
    isCard: el.getAttribute("data-scroll-fade") === "card",
    hinted: false,
  }));

  onScroll();

  if (!listenersAttached) {
    listenersAttached = true;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }
}

document.addEventListener("astro:page-load", initScrollFade);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScrollFade);
} else {
  initScrollFade();
}
