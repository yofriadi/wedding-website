/**
 * Bidirectional scroll-driven fade & slide animation.
 *
 * Smoothly fades in and slides up elements as they enter the viewport from the bottom,
 * and smoothly reverses back out when scrolling back up or past the top.
 * Honors prefers-reduced-motion.
 */

let activeElements: HTMLElement[] = [];
let listenersAttached = false;
let ticking = false;

function updateElement(el: HTMLElement, vh: number) {
  const rect = el.getBoundingClientRect();
  const isCard = el.getAttribute("data-scroll-fade") === "card";

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

  el.style.opacity = opacity.toFixed(4);
  el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
}

function onScroll() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(() => {
      const vh = window.innerHeight;
      activeElements.forEach((el) => updateElement(el, vh));
      ticking = false;
    });
  }
}

export function initScrollFade() {
  activeElements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-fade]"));
  if (activeElements.length === 0) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    activeElements.forEach((el) => {
      el.style.opacity = "1";
      el.style.transform = "none";
      el.style.willChange = "auto";
    });
    return;
  }

  activeElements.forEach((el) => {
    el.style.willChange = "transform, opacity";
  });

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
