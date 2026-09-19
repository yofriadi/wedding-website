/*! M3 geometry/animation: @alerix/m3-loading-indicator (Apache-2.0).
 * License and attribution: /licenses/m3-loading-indicator/{LICENSE,NOTICE}. */
import {
  drawIndicator,
  getMorphedShape,
  M3Animator,
  setupCanvas,
  type Point,
} from "@alerix/m3-loading-indicator";
import { cubicBezier } from "motion";

const MORPH_MS = 240;
const SHAPE_RATIO = 0.79; // The library's 38dp shape inside a 48dp indicator.
// JS counterpart of --ease-in-out-strong; the loading loop uses M3's own spring.
const morphEase = cubicBezier(0.77, 0, 0.175, 1);

/** Morph the icon's filled circle itself, rather than placing a spinner inside it. */
export function initPhotoUploadIndicator(icon: HTMLElement) {
  const canvas = icon.querySelector<HTMLCanvasElement>("[data-photo-indicator]");
  if (!canvas?.getContext("2d")) return { setUploading: (_: boolean) => {}, destroy: () => {} };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
  const animator = new M3Animator();
  let ctx: CanvasRenderingContext2D;
  let size = 0;
  let dpr = 0;
  let color = "";
  let frame = 0;
  let disposed = false;
  let uploading = false;
  let amount = 0;
  let transition: { from: number; to: number; start: number } | null = null;

  const paint = () => {
    if (!ctx || !size) return;
    if (amount === 0) {
      // Use a true circle at rest, identical to the CSS fallback (no polygon seam).
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    const points = getMorphedShape(animator.morph).map(([x, y]): Point => {
      // Project each live point radially onto the circle. Keeping corresponding
      // angles avoids a twist or a jump when a request finishes mid-shape.
      const radius = Math.hypot(x, y) || 1;
      const scale = (1 - amount) / radius + amount * SHAPE_RATIO;
      return [x * scale, y * scale];
    });
    drawIndicator(ctx, size, points, animator.rotation, { color, sizeRatio: 1 });
  };

  const measure = () => {
    if (disposed) return;
    const style = getComputedStyle(icon);
    const nextSize = Number.parseFloat(style.width);
    const nextDpr = window.devicePixelRatio || 1;
    color = style.getPropertyValue("--cta-icon-bg").trim();
    if (nextSize > 0 && (nextSize !== size || nextDpr !== dpr)) {
      size = nextSize;
      dpr = nextDpr;
      ctx = setupCanvas(canvas, size);
    }
    paint();
    if (ctx) icon.setAttribute("data-indicator-ready", "");
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const rebaseClock = () => {
    // Paused update changes only the timestamp, preserving the current shape.
    animator.paused = true;
    animator.update(performance.now());
    animator.paused = false;
  };

  const tick = (now: number) => {
    frame = 0;
    if (disposed) return;
    if (uploading) animator.update(now);
    if (transition) {
      const progress = Math.min(1, (now - transition.start) / MORPH_MS);
      amount = transition.from + (transition.to - transition.from) * morphEase(progress);
      if (progress === 1) {
        amount = transition.to;
        transition = null;
      }
    }
    paint();
    if (uploading || transition) frame = requestAnimationFrame(tick);
    else animator.reset();
  };

  const resume = () => {
    if (
      disposed ||
      reducedMotion.matches ||
      document.hidden ||
      frame ||
      (!uploading && !transition)
    )
      return;
    rebaseClock();
    frame = requestAnimationFrame(tick);
  };

  const settle = () => {
    stop();
    transition = null;
    amount = uploading ? 1 : 0;
    if (reducedMotion.matches || !uploading) animator.reset();
    paint();
  };

  const setUploading = (next: boolean) => {
    if (disposed || next === uploading) return;
    uploading = next;
    if (reducedMotion.matches || document.hidden) {
      settle();
      return;
    }
    // Retarget from the last painted amount, including a retry during the exit.
    transition = { from: amount, to: next ? 1 : 0, start: performance.now() };
    rebaseClock();
    resume();
  };

  const motionChanged = () => {
    settle();
    resume();
  };
  const visibilityChanged = () => {
    if (document.hidden) settle();
    else resume();
  };
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(icon);
  reducedMotion.addEventListener("change", motionChanged);
  colorScheme.addEventListener("change", measure);
  window.addEventListener("resize", measure);
  document.addEventListener("visibilitychange", visibilityChanged);
  measure();

  return {
    setUploading,
    destroy() {
      disposed = true;
      stop();
      resizeObserver.disconnect();
      reducedMotion.removeEventListener("change", motionChanged);
      colorScheme.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", visibilityChanged);
      icon.removeAttribute("data-indicator-ready");
      ctx?.clearRect(0, 0, size, size);
    },
  };
}
