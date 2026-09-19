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
