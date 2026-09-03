// Slot-machine rolling digit counter.
// Vanilla custom-element port of beui.dev/components/motion/number (NumberTicker)
// using motion's imperative animate() — same visual, but the server-rendered
// digits are truthful at first paint and with JavaScript disabled.
//
// Usage: <number-ticker>123</number-ticker>
//   - Initial digits come from the element's text content (SSR-friendly).
//   - Update via `el.value = 137` or `el.setAttribute("value", "137")`.
//   - Entrance stagger plays once when the element scrolls into view
//     (data-start-on-view); later updates roll immediately.
//   - prefers-reduced-motion: digits stay plain text, updates swap instantly.

import { animate } from "motion";

const DIGIT_HEIGHT_EM = 1.1;
const DIGITS = Array.from({ length: 10 }, (_, n) => n);
// JS twin of the CSS --ease-out-expo token; keep in sync.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
const ROLL_DURATION_S = 0.9;
const ENTRANCE_BASE_DELAY_S = 0.8;
const ENTRANCE_STAGGER_S = 0.08;

const REDUCE_MOTION = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

class NumberTicker extends HTMLElement {
  static observedAttributes = ["value"];

  private entered = false;
  private inView = false;
  private observer: IntersectionObserver | null = null;
  // Place-value keyed digit columns: index 0 = ones, 1 = tens, ...
  private columns = new Map<
    number,
    { wrap: HTMLSpanElement; column: HTMLElement; digit: number }
  >();
  connectedCallback() {
    if (REDUCE_MOTION()) {
      return; // Plain text forever; attribute changes swap textContent.
    }
    const text = this.readValue();
    if (!this.hasAttribute("value")) {
      this.setAttribute("value", text);
    }
    const container = document.createElement("span");
    container.setAttribute("aria-hidden", "true");
    container.style.display = "inline-flex";
    container.style.alignItems = "center";

    // Remove the SSR text digits but keep the sr-only span (if any).
    for (const node of Array.from(this.childNodes)) {
      if (!(node instanceof HTMLElement && node.classList.contains("sr-only"))) {
        node.remove();
      }
    }
    this.appendChild(container);

    this.buildColumns(container, text);

    if (this.hasAttribute("data-start-on-view") && "IntersectionObserver" in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.inView = true;
            this.observer?.disconnect();
            this.observer = null;
            this.render(this.readValue());
          }
        },
        { threshold: 0.5 },
      );
      this.observer.observe(this);
    } else {
      this.inView = true;
      this.render(text);
    }
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null) {
    if (name !== "value") return;
    const text = next ?? "0";
    if (REDUCE_MOTION() || this.columns.size === 0) {
      this.setPlainText(text);
      return;
    }
    // If waiting to start on view and not in view yet, update text without triggering roll early
    if (this.hasAttribute("data-start-on-view") && !this.inView) {
      return;
    }
    this.render(text);
  }

  get value(): string {
    return this.getAttribute("value") ?? this.textContent?.trim() ?? "0";
  }

  set value(next: number | string) {
    this.setAttribute("value", String(next));
  }

  private readValue(): string {
    return (this.getAttribute("value") ?? this.textContent ?? "0").replace(/[^0-9]/g, "") || "0";
  }

  private getBaseDelay(): number {
    const raw = this.getAttribute("data-delay") ?? this.getAttribute("delay");
    if (raw) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return raw.endsWith("ms") ? parsed / 1000 : parsed;
      }
    }
    return ENTRANCE_BASE_DELAY_S;
  }

  private setPlainText(text: string) {
    const srOnly = this.querySelector(".sr-only");
    this.textContent = text;
    if (srOnly) this.appendChild(srOnly);
  }

  private buildColumns(container: HTMLSpanElement, text: string) {
    const len = text.length;
    for (let i = 0; i < len; i++) {
      const place = len - 1 - i;
      const wrap = document.createElement("span");
      wrap.style.cssText = `position:relative;display:inline-block;overflow:hidden;height:${DIGIT_HEIGHT_EM}em;width:1ch;`;
      const column = document.createElement("span");
      column.style.cssText =
        "position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center;will-change:transform;";
      for (const n of DIGITS) {
        const cell = document.createElement("span");
        cell.style.cssText = `display:flex;height:${DIGIT_HEIGHT_EM}em;align-items:center;justify-content:center;line-height:1;`;
        cell.textContent = String(n);
        column.appendChild(cell);
      }
      wrap.appendChild(column);
      container.appendChild(wrap);
      this.columns.set(place, { wrap, column, digit: 0 });
    }
  }

  private render(text: string) {
    const digits = text.split("").map(Number);

    // Grow on the left for higher place values without remounting existing
    // columns (999 -> 1000 adds the thousands column only).
    const container = this.querySelector("span[aria-hidden]");
    if (container instanceof HTMLSpanElement && digits.length > this.columns.size) {
      for (let place = this.columns.size; place < digits.length; place++) {
        const wrap = document.createElement("span");
        wrap.style.cssText = `position:relative;display:inline-block;overflow:hidden;height:${DIGIT_HEIGHT_EM}em;width:1ch;`;
        const column = document.createElement("span");
        column.style.cssText =
          "position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center;will-change:transform;";
        for (const n of DIGITS) {
          const cell = document.createElement("span");
          cell.style.cssText = `display:flex;height:${DIGIT_HEIGHT_EM}em;align-items:center;justify-content:center;line-height:1;`;
          cell.textContent = String(n);
          column.appendChild(cell);
        }
        wrap.appendChild(column);
        container.prepend(wrap);
        this.columns.set(place, { wrap, column, digit: 0 });
      }
    }

    const baseDelay = this.getBaseDelay();
    for (const [place, entry] of this.columns) {
      const target = place < digits.length ? digits[digits.length - 1 - place]! : 0;
      if (target === entry.digit && this.entered) continue;
      const delay = this.entered || !this.inView ? 0 : baseDelay + place * ENTRANCE_STAGGER_S;
      entry.digit = target;
      animate(
        entry.column,
        { transform: `translateY(-${target * DIGIT_HEIGHT_EM}em)` },
        { duration: ROLL_DURATION_S, delay, ease: EASE_OUT_EXPO },
      );
    }

    if (this.inView) {
      this.entered = true;
    }
  }
}

if (!customElements.get("number-ticker")) {
  customElements.define("number-ticker", NumberTicker);
}

export {};
