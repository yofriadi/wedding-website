import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
// The slider renders server-side only for cookie-identified invitees, and
// the repo's no-seed convention means the real page shows no control to a test
// run — so the slider capability is covered against the committed static
// fixture (design D7), which is SlideToConfirm's real markup + compiled CSS
// (regenerate: pnpm dev:bare && node scripts/make-slide-to-confirm-fixture.mjs).

const FIXTURE = `file://${fileURLToPath(new URL("./fixtures/slide-to-confirm.html", import.meta.url))}`;

const FRESH = "#slide-fresh";
const CONFIRMED = "#slide-confirmed";

async function openFixture(page: Page) {
  await page.goto(FIXTURE);
  await page.locator(FRESH).scrollIntoViewIfNeeded();
}

/** A resolved CSS color as numeric sRGB channels (0–255) plus alpha. */
type Rgba = [number, number, number, number];

/**
 * The control's palette as the browser resolves it: the two polarity tokens plus
 * every color derived from them. Colors are compared as numbers because a token
 * chain can serialize as `color(srgb …)` while a hex literal serializes as
 * `rgb(…)` — channels keep the assertions about the palette rather than about a
 * serialization form.
 */
async function palette(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    // The probe lives outside the control: appending to an inline-flex button
    // would resize it.
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.append(probe);
    const resolve = (value: string): [number, number, number, number] => {
      probe.style.color = "";
      probe.style.color = value;
      // A var() the probe can't see (it lives outside the control) leaves the
      // declaration invalid and the computed color untouched — detect that
      // instead of silently reading whatever color the probe had before.
      if (probe.style.color === "") return [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
      const out = getComputedStyle(probe).color;
      const nums = (out.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      const [r = 0, g = 0, b = 0, a = 1] = nums;
      // `color(srgb r g b / a)` carries 0–1 channels; `rgb()/rgba()` carry 0–255.
      return out.startsWith("color(") ? [r * 255, g * 255, b * 255, a] : [r, g, b, a];
    };
    // The leading color functions of a gradient value are its stops, in order.
    const stops = (gradient: string, count: number) =>
      (gradient.match(/(?:rgba?|color|hsla?|oklab|oklch)\([^)]*\)/g) ?? [])
        .slice(0, count)
        .map(resolve);

    const style = getComputedStyle(el);
    const handleStyle = getComputedStyle(el.querySelector(".slide-to-confirm__handle")!);
    const out = {
      track: resolve(style.getPropertyValue("--slide-to-confirm-track").trim()),
      surface: resolve(style.getPropertyValue("--slide-to-confirm-surface").trim()),
      ink: resolve(style.getPropertyValue("--slide-to-confirm-ink").trim()),
      handleInk: resolve(style.getPropertyValue("--slide-to-confirm-handle-ink").trim()),
      trackFill: resolve(style.backgroundColor),
      handle: resolve(handleStyle.backgroundColor),
      handleIcon: resolve(handleStyle.color),
      // The computed label color: var(--slide-to-confirm-ink) on an idle pill,
      // the confirmed near-white on a confirmed one — which is why the full
      // palette invariant is only asserted on the fresh control (see
      // expectFreshPalette).
      label: resolve(getComputedStyle(el.querySelector(".slide-to-confirm__label")!).color),
    };
    probe.remove();
    return out;
  });
}

function expectSameColor(actual: Rgba, expected: Rgba, label: string) {
  for (const [i, channel] of ["r", "g", "b"].entries()) {
    expect(Math.abs(actual[i] - expected[i]), `${label}: ${channel}`).toBeLessThanOrEqual(1);
  }
  expect(actual[3], `${label}: alpha`).toBeCloseTo(expected[3], 2);
}

/**
 * The invariant that makes the two themes each other's mirror: every painted
 * color is one of the two polarity tokens. Asserted in BOTH themes — a
 * hard-coded color that happened to match one theme fails in the other, which
 * is exactly the regression this guards.
 */
function expectDerivedPalette(p: Awaited<ReturnType<typeof palette>>) {
  expectSameColor(p.trackFill, p.track, "track fill");
  expectSameColor(p.handle, p.surface, "handle fill");
  const luma = (c: Rgba) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // Contrast, stated twice: the handle stands clear of its track, and the
  // ink stands clear of the track it prints on — so "derived" can never be
  // satisfied by colors that blur into the ground.
  expect(Math.abs(luma(p.surface) - luma(p.track))).toBeGreaterThan(150);
  expect(Math.abs(luma(p.ink) - luma(p.track))).toBeGreaterThan(150);
}

/**
 * The idle (fresh) control's full invariant — every painted color, label
 * included, is one of the theme tokens. The confirmed control's label is
 * deliberately NOT a theme color (the fill's near-white), so it gets
 * expectDerivedPalette only.
 */
function expectFreshPalette(p: Awaited<ReturnType<typeof palette>>) {
  expectDerivedPalette(p);
  expectSameColor(p.label, p.ink, "label");
  // The handle's glyph is the handle's own opposite, never the label ink —
  // on a dark page the ink matches the light handle and would paint the
  // chevron invisible.
  expectSameColor(p.handleIcon, p.handleInk, "handle icon");
  const luma = (c: Rgba) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  expect(Math.abs(luma(p.handleIcon) - luma(p.handle))).toBeGreaterThan(150);
}

const NEAR_WHITE: Rgba = [250, 250, 250, 1]; // #fafafa
const NEAR_BLACK: Rgba = [10, 10, 10, 1]; // #0a0a0a
const TRACK_DARK: Rgba = [38, 38, 38, 1]; // #262626
const TRACK_LIGHT: Rgba = [245, 245, 245, 1]; // #f5f5f5

/**
 * Re-types the fresh control as a real submit button inside a real form and
 * counts dispatched submits: the fixture's buttons are type=button, but the
 * arming gesture's click must reach a form for the RSVP POST to ever fire.
 */
async function probeSubmits(page: Page) {
  await page.evaluate(() => {
    const btn = document.querySelector<HTMLButtonElement>("[data-slide-to-confirm]")!;
    const form = document.createElement("form");
    btn.replaceWith(form);
    form.append(btn);
    btn.type = "submit";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      (window as unknown as { __submits: number }).__submits =
        ((window as unknown as { __submits: number }).__submits || 0) + 1;
    });
  });
}

test.describe("slide-to-confirm", () => {
  test("dark baseline: a light handle and label on a flat track", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    // The type and padding scale with the viewport (see the fluid-width test),
    // so the reference figures are asserted above the clamp's upper knee —
    // pinned here because the mobile project's viewport is below it.
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);

    // The control is the inverse of the page: on a dark page the track is a
    // dark-gray muted pill, the handle the light solid, the label light ink.
    const p = await palette(page, FRESH);
    expectSameColor(p.track, TRACK_DARK, "track");
    expectSameColor(p.surface, NEAR_WHITE, "surface");
    expectSameColor(p.ink, NEAR_WHITE, "ink");
    expectFreshPalette(p);

    // Typography matches the reference verbatim: 14px, medium, sentence case,
    // normal tracking — no uppercase treatment.
    await expect(page.locator(FRESH)).toHaveCSS("font-size", "14px");
    await expect(page.locator(FRESH)).toHaveCSS("font-weight", "500");
    await expect(page.locator(FRESH)).toHaveCSS("letter-spacing", "normal");
    await expect(page.locator(FRESH)).toHaveCSS("text-transform", "none");
    await expect(page.locator(FRESH)).toHaveCSS("height", "58px");
    // It is a slider, not a button: the pointer affordance is grab, not click.
    await expect(page.locator(FRESH)).toHaveCSS("cursor", "grab");
  });

  test("fluid width: one line, inside the viewport, from 320px up", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);

    // The reference's flat 3.5rem padding overflows a small phone with the
    // longer (confirmed) label, so padding and type are clamped against the
    // viewport. What must hold at every width: no horizontal overflow, and the
    // label on a single line — a wrapped label would break the pill's height.
    for (const width of [320, 375, 412, 768, 1280]) {
      await page.setViewportSize({ width, height: 600 });
      const state = await page.evaluate(() => ({
        overflows: document.documentElement.scrollWidth > window.innerWidth,
        buttons: [...document.querySelectorAll<HTMLElement>("[data-slide-to-confirm]")].map(
          (el) => {
            const label = el.querySelector<HTMLElement>("[data-slide-to-confirm-text]")!;
            return {
              height: Math.round(el.getBoundingClientRect().height),
              // The label's box is the full-height canvas; its line count is
              // the line-height style (a wrapped second line would overflow).
              lineHeight: Number.parseFloat(getComputedStyle(label).lineHeight),
              whiteSpace: getComputedStyle(label).whiteSpace,
              labelWidth: Math.round(label.getBoundingClientRect().width),
              trackWidth: Math.round(el.getBoundingClientRect().width),
            };
          },
        ),
      }));
      expect(state.overflows, `horizontal overflow at ${width}px`).toBe(false);
      for (const button of state.buttons) {
        expect(button.height, `pill height at ${width}px`).toBe(58);
        // One 1.5rem line: nowrap keeps the label on a single line, and the
        // line box stays the 24px token rather than stretching for a wrap.
        expect(button.whiteSpace, `label wrap at ${width}px`).toBe("nowrap");
        expect(button.lineHeight, `label lines at ${width}px`).toBeLessThanOrEqual(26);
        // The canvas never outgrows the track it centers on.
        expect(button.labelWidth, `label inside track at ${width}px`).toBeLessThanOrEqual(
          button.trackWidth,
        );
      }
    }
  });

  test("light theme flips the polarity, and only the polarity", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);
    const dark = await palette(page, FRESH);

    await page.emulateMedia({ colorScheme: "light" });
    // The label's color rides the morph transition (380ms), so a live theme
    // flip lands on a mid-fade value — wait it out before sampling.
    await page.waitForTimeout(500);
    const light = await palette(page, FRESH);

    // On a white page the track is a light-gray muted pill with the dark
    // handle and dark ink — the dark presentation mirrored, token for token.
    expectSameColor(light.track, TRACK_LIGHT, "track");
    expectSameColor(light.surface, NEAR_BLACK, "surface");
    expectSameColor(light.ink, NEAR_BLACK, "ink");
    // The flip is total: light track/ink are the dark one's counterparts
    // (handle is the odd one out — the light handle IS the dark track's ink).
    expectFreshPalette(light);
  });

  test("the track is flat: a hairline, no gradient, no rim, nothing rotates", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);

    // The old style is gone by construction: no conic sweep on the root, no
    // extra paint layers, no CSS animation anywhere in the control.
    await expect(page.locator(FRESH)).toHaveCSS("background-image", "none");
    await expect(page.locator(FRESH)).toHaveCSS("animation-name", "none");
    await expect(page.locator(FRESH)).toHaveCSS("border-top-width", "1px");
    const layers = await page.locator(FRESH).evaluate((el) => ({
      pseudo: getComputedStyle(el, "::after").content,
      children: [...el.children].map((c) => (c as HTMLElement).className),
    }));
    expect(layers.pseudo).toBe("none");
    expect(layers.children).toEqual(["slide-to-confirm__label", "slide-to-confirm__handle"]);

    // …but the pill silhouette and its inset handle keep the house geometry.
    const geometry = await page.locator(FRESH).evaluate((el) => {
      const style = getComputedStyle(el);
      const handle = getComputedStyle(el.querySelector(".slide-to-confirm__handle")!);
      return {
        radius: style.borderTopLeftRadius,
        handleRadius: handle.borderTopLeftRadius,
        handleInset: [handle.top, handle.left],
      };
    });
    expect(geometry.radius).toBe("50px");
    expect(geometry.handleRadius).toBe("46px");
    expect(geometry.handleInset).toEqual(["4px", "4px"]);
  });

  test("markup: label and handle — the label is the only text", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);
    // The slider is two layers plus the handle's two icons (chevrons idle,
    // check confirmed; one is always display:none).
    await expect(page.locator(`${FRESH} > .slide-to-confirm__label`)).toHaveCount(1);
    await expect(page.locator(`${FRESH} > .slide-to-confirm__handle`)).toHaveCount(1);
    expect(await page.locator(`${FRESH} svg`).count()).toBe(2);
    // The handle is presentation: the button's own activation is the
    // accessible control, so the handle must not leak into the a11y tree.
    await expect(page.locator(`${FRESH} > .slide-to-confirm__handle`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("confirmed at render: fill applied, handle parked at the far end", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);
    expect(await page.locator(CONFIRMED).evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(
      true,
    );
    // The confirmed presentation is state, not affordance: no opacity dim,
    // no pointer.
    await expect(page.locator(CONFIRMED)).toHaveCSS("opacity", "1");
    await expect(page.locator(CONFIRMED)).toHaveCSS("cursor", "default");
    // The morph is on from the first frame (the script applies the class to a
    // server-confirmed control): the track is filled and the handle sits at
    // the end of its travel showing the check.
    await expect(page.locator(CONFIRMED)).toHaveClass(/slide-to-confirm--confirmed/);
    const parked = await page
      .locator(`${CONFIRMED} [data-slide-to-confirm-handle]`)
      .evaluate((el) => {
        const x = Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x"));
        return {
          x,
          chevrons: getComputedStyle(el.querySelector(".slide-to-confirm__icon--chevrons")!)
            .opacity,
          // The morph replaces the display swap: the check is always present,
          // its stroke merely undrawn (dashoffset 1) while idle and fully
          // drawn (0) once confirmed.
          check: Number.parseFloat(
            getComputedStyle(
              el.querySelector<SVGGeometryElement>(".slide-to-confirm__icon--check path")!,
            ).strokeDashoffset,
          ),
        };
      });
    expect(parked.x).toBeGreaterThan(0);
    expect(Number(parked.chevrons)).toBe(0);
    expect(Number(parked.check)).toBe(0);
    // The fill is the one deliberate hard-coded color: solid black with
    // near-white text in BOTH themes (the tweak).
    const fill = await page
      .locator(CONFIRMED)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toBe("rgb(0, 0, 0)");
    // The label flips to the fill's near-white on the morph transition.
    await expect
      .poll(async () =>
        page
          .locator(`${CONFIRMED} [data-slide-to-confirm-text]`)
          .evaluate((el) => getComputedStyle(el).color),
      )
      .toBe("rgb(250, 250, 250)");
  });

  test("reduced motion: no transitions anywhere, still readable", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await openFixture(page);

    await expect(page.locator(FRESH)).toHaveCSS("animation-name", "none");
    await expect(page.locator(FRESH)).toHaveCSS("transition-duration", "0s");
    await expect(page.locator(`${FRESH} .slide-to-confirm__handle`)).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await expect(page.locator(`${FRESH} .slide-to-confirm__label`)).toHaveCSS(
      "transition-duration",
      "0s",
    );

    // Static is a composition, not a void: handle, label and palette survive.
    expectFreshPalette(await palette(page, FRESH));
    // Reduced motion wins over the confirmed morph too.
    await expect(page.locator(CONFIRMED)).toHaveCSS("transition-duration", "0s");
  });

  test("no JavaScript: the control still renders, readable and unshifted", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto(FIXTURE);

    // Nothing about the presentation was ever script-driven.
    expect(
      await page.locator(FRESH).evaluate((el) => el.getBoundingClientRect().height),
    ).toBeCloseTo(58, 0);
    await expect(page.locator(FRESH)).toHaveCSS("border-top-width", "1px");
    await expect(
      page.getByRole("button", { name: "Confirm Reservation", exact: true }),
    ).toBeVisible();
    await ctx.close();
  });

  test("forced colors: system-color outline and text", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
    await openFixture(page);

    // The hairline survives the palette swap as a system border and the
    // label as plain system text.
    await expect(page.locator(FRESH)).toHaveCSS("background-image", "none");
    await expect(page.locator(FRESH)).toHaveCSS("border-top-width", "1px");
    expect(
      await page
        .locator(`${FRESH} .slide-to-confirm__label`)
        .evaluate((el) => getComputedStyle(el).color),
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(
      await page.locator(FRESH).evaluate((el) => el.getBoundingClientRect().height),
    ).toBeCloseTo(58, 0);
  });

  test("keyboard focus is visible against the track, and pointer presses stay clean", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);

    // The UA ring would land on the hairline and disappear, so the component
    // replaces it with an offset ring in the pill's own polarity.
    await page.keyboard.press("Tab");
    await expect(page.locator(FRESH)).toBeFocused();
    const focused = await page.locator(FRESH).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        width: style.outlineWidth,
        offset: style.outlineOffset,
        color: style.outlineColor,
        surface: style.getPropertyValue("--slide-to-confirm-surface").trim(),
      };
    });
    expect(focused.width).toBe("2px");
    // Offset clear of the band, so the ring is not read as part of the sweep.
    expect(Number.parseFloat(focused.offset)).toBeGreaterThan(0);
    // Outside the pill the ground is the ink color, so the ring has to be the
    // surface to be visible at all.
    expect(focused.color).toBe("rgb(250, 250, 250)");
    expect(focused.surface).toBe("#fafafa");

    // :focus-visible only — a mouse press must not leave a ring behind.
    await page.mouse.click(10, 10);
    await page.locator(FRESH).click();
    await expect(page.locator(FRESH)).toHaveCSS("outline-style", "none");
  });

  test("the label text is the accessible name, once", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);

    // One label layer, so the name is not doubled.
    await expect(
      page.getByRole("button", { name: "Confirm Reservation", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Confirm Reservation.*Confirm Reservation/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reservation Confirmed", exact: true }),
    ).toHaveCount(1);
  });

  test("a full slide to the far end morphs the pill to black and fires confetti", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);

    // The drag: handle pressed at its home, carried to (and past) the end —
    // the clamp parks it at 100% of the travel.
    const box = (await page.locator(FRESH).boundingBox())!;
    const startX = box.x + 28;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + box.width * 0.6, startY, { steps: 6 });
    // Mid-slide: the handle tracks the pointer and the idle label has faded.
    const mid = await page.locator(FRESH).evaluate((el) => ({
      x: Number.parseFloat(
        el
          .querySelector<HTMLElement>("[data-slide-to-confirm-handle]")!
          .style.getPropertyValue("--slide-to-confirm-x"),
      ),
      labelOpacity: el
        .querySelector<HTMLElement>("[data-slide-to-confirm-text]")!
        .style.getPropertyValue("--slide-to-confirm-label-opacity"),
    }));
    expect(mid.x).toBeGreaterThan(0);
    expect(Number.parseFloat(mid.labelOpacity)).toBeLessThan(1);

    await page.mouse.move(startX + box.width, startY, { steps: 6 });
    await page.mouse.up();

    // Fully slid: the whole track fills black — handle checked at the far
    // end, label in the confirmed near-white.
    await expect(page.locator(FRESH)).toHaveClass(/slide-to-confirm--confirmed/);
    const end = await page.locator(FRESH).evaluate((el) => {
      const handle = el.querySelector<HTMLElement>("[data-slide-to-confirm-handle]")!;
      // The script's range math, mirrored: inner width − handle − 2× inset.
      const range = el.clientWidth - handle.offsetWidth - handle.offsetLeft * 2;
      return {
        range,
        x: Number.parseFloat(handle.style.getPropertyValue("--slide-to-confirm-x")),
      };
    });
    // The spring settles the handle at the exact end of its travel.
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-handle]`)
          .evaluate((el) => Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x"))),
      )
      .toBe(end.range);
    // The color flip rides the morph transition, so poll rather than sample.
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-text]`)
          .evaluate((el) => getComputedStyle(el).color),
      )
      .toBe("rgb(250, 250, 250)");

    // The MagicUI-style burst fires from the pill's center: canvas-confetti
    // appends a full-viewport canvas for the volley. (The CDN import needs
    // the network; no canvas at all means the volley never ran.)
    await expect
      .poll(async () => page.locator("canvas").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test("a short slide springs the handle back and stays idle", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);

    const box = (await page.locator(FRESH).boundingBox())!;
    const startX = box.x + 28;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + box.width * 0.4, startY, { steps: 5 });
    await page.mouse.up();

    // Short of the end: no morph, and the handle returns to 0.
    await expect(page.locator(FRESH)).not.toHaveClass(/slide-to-confirm--confirmed/);
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-handle]`)
          .evaluate((el) =>
            Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x") || "0"),
          ),
      )
      .toBe(0);
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-text]`)
          .evaluate((el) => el.style.getPropertyValue("--slide-to-confirm-label-opacity")),
      )
      .toBe("1");
    expect(await page.locator("canvas").count()).toBe(0);
  });

  test("a nudge near the end — a drag short of a full slide — springs back", async ({ page }) => {
    // Only a release with the handle parked at the FAR END arms: a pointer
    // that lands ON the handle and moves a few pixels is nowhere close, so it
    // springs home and stays idle.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);

    const box = (await page.locator(FRESH).boundingBox())!;
    const startX = box.x + 28;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Land on the handle and move ~12px — far short of the full slide.
    await page.mouse.move(startX + 12, startY, { steps: 3 });
    await page.mouse.up();

    await expect(page.locator(FRESH)).not.toHaveClass(/slide-to-confirm--confirmed/);
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-handle]`)
          .evaluate((el) =>
            Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x") || "0"),
          ),
      )
      .toBe(0);
    expect(await page.locator("canvas").count()).toBe(0);
  });

  test("a tap — press and release without sliding — never confirms or submits", async ({
    page,
  }) => {
    // The regression this locks: this control is a slider, not a button. A
    // pointer tap (detail ≥ 1 click that no armed release flagged) must be
    // swallowed — no morph, no confetti, and above all no submit; only a full
    // slide arms. Taps on both the pill and the handle itself are covered.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);
    await probeSubmits(page);

    await page.locator(FRESH).click();
    await page.locator(`${FRESH} .slide-to-confirm__handle`).click();

    await expect(page.locator(FRESH)).not.toHaveClass(/slide-to-confirm--confirmed/);
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-handle]`)
          .evaluate((el) =>
            Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x") || "0"),
          ),
      )
      .toBe(0);
    expect(await page.locator("canvas").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __submits?: number }).__submits)).toBe(
      undefined,
    );
  });

  test("a release with the handle parked at the far end morphs and still submits", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);

    // Release AT the end (the drag overshoots; the clamp parks the handle at
    // 100%): the gesture arms (morph + confetti) and its own click must reach
    // the form — swallowing it was the old bug: black pill, no POST.
    await probeSubmits(page);
    const box = (await page.locator(FRESH).boundingBox())!;
    const startX = box.x + 28;
    const startY = box.y + box.height / 2;
    // The script's range math, mirrored exactly: content-box width minus the
    // handle and its (symmetric) insets.
    const range = await page.locator(FRESH).evaluate((el) => {
      const handle = el.querySelector<HTMLElement>("[data-slide-to-confirm-handle]")!;
      return el.clientWidth - handle.offsetWidth - handle.offsetLeft * 2;
    });
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Overshoot past the far edge; the clamp holds the handle at exactly range.
    await page.mouse.move(startX + range + 24, startY, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator(FRESH)).toHaveClass(/slide-to-confirm--confirmed/);
    // The handle rides to the far end and STAYS there.
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-handle]`)
          .evaluate((el) => Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x"))),
      )
      .toBe(range);
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __submits: number }).__submits))
      .toBe(1);
  });

  test("a pointercancel mid-slide springs back — it never confirms", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 900, height: 600 });
    await openFixture(page);

    const box = (await page.locator(FRESH).boundingBox())!;
    const startX = box.x + 28;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + box.width * 0.6, startY, { steps: 5 });
    // The browser takes the gesture back (scroll takeover, OS gesture): the
    // only honest outcome is the spring home. The cancel has to carry the
    // captured pointerId (Playwright's real pointer is 1) — a plain Event
    // wouldn't match the drag.
    await page
      .locator(FRESH)
      .evaluate((el) =>
        el.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })),
      );

    await expect(page.locator(FRESH)).not.toHaveClass(/slide-to-confirm--confirmed/);
    await expect
      .poll(async () =>
        page
          .locator(`${FRESH} [data-slide-to-confirm-handle]`)
          .evaluate((el) =>
            Number.parseFloat(el.style.getPropertyValue("--slide-to-confirm-x") || "0"),
          ),
      )
      .toBe(0);
    expect(await page.locator("canvas").count()).toBe(0);
  });

  test("keyboard activation counts as a full slide", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openFixture(page);

    // A keyboard can't drag: Enter on the focused control IS the slide (it is
    // a click with no pointer, and the fixture's buttons are type=button, so
    // nothing navigates).
    await page.locator(FRESH).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(FRESH)).toHaveClass(/slide-to-confirm--confirmed/);
    await expect
      .poll(async () => page.locator("canvas").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });
});
