import { test, expect, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

/**
 * families-reveal — the hosts' families section.
 *
 * Guards the `families-section` spec's content/theme/accessibility
 * requirements and the `scroll-motion` additions for the travelling reveal:
 * the copy flows normally (no pinned stage) and every word inks as its
 * document position crosses the viewport's centre band — ghost below, ink at
 * the band, inked all the way up after it.
 *
 * The 28-word copy below is the authored block order and doubles as the
 * expected accessible-text sequence.
 */
const EXPECTED_WORDS = [
  "Keluarga",
  "Bapak",
  "Ch.",
  "Fuad",
  "Ery",
  "Pribadi",
  "Ibu",
  "Siti",
  "Mufrodah",
  "Jl.",
  "Dr.",
  "Wahidin",
  "49,",
  "Surakarta",
  "Keluarga",
  "Bapak",
  "Hermansyah",
  "Ibu",
  "Nur",
  "Faizah",
  "Jl.",
  "Kemanggisan",
  "Ilir",
  "No.",
  "58a,",
  "Palmerah,",
  "Jakarta",
  "Barat",
  "Ya",
  "Allah,",
  "izinkanlah",
  "putra-putri",
  "kami",
  "menikah",
  "Aisha",
  "Astri",
  "Amalia",
  "Putri",
  "dari",
  "Ibu",
  "Siti",
  "Mufrodah",
  "&",
  "Bapak",
  "M.",
  "David",
  "R.",
  "Wijaya",
  "Bapak",
  "Ch.",
  "Fuad",
  "Ery",
  "Pribadi",
  "-",
  "Ibu",
  "Siti",
  "Mufrodah",
  "dengan",
  "Muhammad",
  "Yofri",
  "Adi",
  "Yahya",
  "Putra",
  "dari",
  "Ibu",
  "Nur",
  "Faizah",
  "&",
  "Bapak",
  "Ahmad",
  "Tukul",
  "Bapak",
  "Hermansyah",
  "-",
  "Ibu",
  "Nur",
  "Faizah",
];

test.setTimeout(120_000);

/** Document position of the families section's top edge. */
function sectionTop(page: Page) {
  return page.evaluate(() => {
    const section = document.getElementById("families-section");
    if (!section) throw new Error("#families-section not found");
    return section.getBoundingClientRect().top + window.scrollY;
  });
}

/** Scroll so the section's top sits at `fraction` of the viewport height. */
async function scrollSectionTopTo(page: Page, fraction: number) {
  const top = await sectionTop(page);
  const viewportH = await page.evaluate(() => window.innerHeight);
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top - viewportH * fraction));
  await page.waitForTimeout(250);
}

function inkOpacities(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#families-section .fw")].map((el) =>
      Number(getComputedStyle(el).opacity),
    ),
  );
}

test.describe("travelling reveal — ghost below the band, ink at the band, inked after", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * The reveal maps viewport position, not section progress: words enter at
   * the ghost floor while their centre is below the reveal band (~90% of the
   * viewport down), ink as they cross it, and stay inked — still moving —
   * above ~57.5%. The section itself never pins.
   */
  test("each word inks as it crosses the centre band and stays inked while travelling up", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    // Scroll so the Nth word's centre sits at `fraction` of the viewport —
    // targets real words, so the stops are robust to section height and
    // wrapping changes.
    const scrollWordTo = async (wordIndex: number, fraction: number) => {
      await page.evaluate(
        ({ wordIndex, fraction }) => {
          const words = document.querySelectorAll("#families-section .fw");
          const el = words[wordIndex];
          if (!el) throw new Error(`word ${wordIndex} not found`);
          const rect = el.getBoundingClientRect();
          window.scrollTo(
            0,
            window.scrollY + (rect.top + rect.height / 2) - window.innerHeight * fraction,
          );
        },
        { wordIndex, fraction },
      );
      await page.waitForTimeout(250);
    };

    const firstWordViewportFraction = () =>
      page.evaluate(() => {
        const el = document.querySelector("#families-section .fw");
        if (!el) throw new Error("no words found");
        const rect = el.getBoundingClientRect();
        return (rect.top + rect.height / 2) / window.innerHeight;
      });

    // Approaching: the first word sits well below the reveal band — every
    // word is at the ghost floor (faint, still readable).
    await scrollWordTo(0, 0.98);
    const below = await inkOpacities(page);
    expect(below).toHaveLength(EXPECTED_WORDS.length);
    expect(
      below.every((o) => o <= 0.15),
      "words below the reveal band sit at the ghost floor — faint, readable",
    ).toBe(true);
    const fractionBelow = await firstWordViewportFraction();

    // Crossing: the first word is at the band (inked), the last word still
    // waits below it (ghost) — a clean top-to-bottom wave with a gradient.
    await scrollWordTo(0, 0.5);
    const lastFraction = await page.evaluate(() => {
      const words = document.querySelectorAll("#families-section .fw");
      const rect = words[words.length - 1].getBoundingClientRect();
      return (rect.top + rect.height / 2) / window.innerHeight;
    });
    const mid = await inkOpacities(page);
    expect(mid[0], "the leading word has inked at the band").toBeGreaterThanOrEqual(0.9);
    expect(
      lastFraction,
      "the last word is still below the reveal band (0.9) while the first inks",
    ).toBeGreaterThan(0.575);
    expect(mid.at(-1)!, "the trailing word has not inked yet").toBeLessThan(0.6);
    expect(
      mid.some((o) => o > 0.2 && o < 0.9),
      "the sweep has a gradient, not a hard cut",
    ).toBe(true);

    // Past the band: the last word has inked too — the whole copy is revealed.
    await scrollWordTo(EXPECTED_WORDS.length - 1, 0.5);
    const above = await inkOpacities(page);
    expect(
      above.every((o) => o >= 1 - 1e-9),
      "every word is full ink above the band",
    ).toBe(true);
    const fractionAbove = await firstWordViewportFraction();
    expect(fractionAbove, "the section really travelled through the viewport").toBeLessThan(
      fractionBelow,
    );

    // …and it STAYS inked as it keeps travelling up out of view.
    await scrollWordTo(EXPECTED_WORDS.length - 1, -0.1);
    const gone = await inkOpacities(page);
    expect(
      gone.every((o) => o >= 1 - 1e-9),
      "words keep their ink as they leave the viewport",
    ).toBe(true);

    // Scrubbing back down un-reveals: the words return to the ghost floor.
    await scrollWordTo(0, 0.98);
    const back = await inkOpacities(page);
    expect(back[0], "reverse-scrub returns the ghost floor").toBeLessThanOrEqual(0.15);
  });

  /**
   * There is no pin in this design: the section is plain flow content whose
   * height is its content, and nothing inside it is position: sticky.
   */
  test("the section is ordinary flow content — no sticky stage, content-driven height", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const geometry = await page.evaluate(() => {
      const section = document.getElementById("families-section");
      if (!section) throw new Error("families section not found");
      const sticky = [...section.querySelectorAll("*")].filter(
        (el) => getComputedStyle(el).position === "sticky",
      );
      return {
        sectionH: section.offsetHeight,
        viewportH: window.innerHeight,
        stickyCount: sticky.length,
        sectionPosition: getComputedStyle(section).position,
      };
    });

    expect(geometry.stickyCount, "no pinned stage anywhere in the section").toBe(0);
    expect(geometry.sectionPosition).not.toBe("fixed");
    expect(
      geometry.sectionH,
      "section is a long canvas flowing through the viewport",
    ).toBeGreaterThan(geometry.viewportH * 1.5);
  });
});

test.describe("fit — content stays readable and unclipped at phone sizes", () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
  ]) {
    test.describe(`@ ${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      /**
       * families-section spec: "Long address line does not overflow
       * horizontally" — with the section scrolled fully into view (all
       * words inked), nothing overflows and the body type stays above the
       * ~0.85rem floor that flags a silent shrink.
       */
      test("no horizontal overflow and body type stays above the floor", async ({ page }) => {
        await page.goto("/");
        await dismissWelcomeGate(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        await scrollSectionTopTo(page, 0.3);

        const fit = await page.evaluate(() => {
          const section = document.getElementById("families-section");
          const nameRow = document.querySelector("#families-section .families-names li");
          if (!section || !nameRow) throw new Error("families section not found");
          return {
            docScrollW: document.documentElement.scrollWidth,
            docClientW: document.documentElement.clientWidth,
            sectionScrollW: section.scrollWidth,
            sectionClientW: section.clientWidth,
            fontSize: getComputedStyle(nameRow).fontSize,
            fontSizePx: parseFloat(getComputedStyle(nameRow).fontSize),
          };
        });

        await test.info().attach("computed body font-size", { body: fit.fontSize });
        expect(fit.docScrollW, "no document horizontal overflow").toBeLessThanOrEqual(
          fit.docClientW,
        );
        expect(fit.sectionScrollW, "no section horizontal overflow").toBeLessThanOrEqual(
          fit.sectionClientW,
        );
        expect(
          fit.fontSizePx,
          `body font-size ${fit.fontSize} regressed below ~0.85rem (13.6px)`,
        ).toBeGreaterThanOrEqual(0.85 * 16);
      });
    });
  }
});

test.describe("accessibility", () => {
  /**
   * families-section spec: "Assistive technology hears each word once".
   * Single-tier words — no ghost layer — so the section's accessible text
   * is exactly the 28 words in block order.
   */
  test("the section's accessible text is each word exactly once, in block order", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const words = await page.evaluate(() => {
      const section = document.getElementById("families-section");
      if (!section) throw new Error("families section not found");
      const out: string[] = [];
      const walk = (node: Element) => {
        if (node.getAttribute("aria-hidden") === "true") return;
        for (const child of node.children) walk(child);
        const own = [...node.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim() ?? "")
          .join("")
          .trim();
        if (own) out.push(own);
      };
      walk(section);
      return out;
    });

    expect(words).toEqual(EXPECTED_WORDS);
  });
});

test.describe("reduced motion", () => {
  /**
   * scroll-motion spec: "FamiliesReveal honors reduced motion" — the
   * authored state is reveal-complete, the scrub is never bound, and the
   * copy is plain readable text.
   */
  test("no scrub binds and every word is full ink", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await scrollSectionTopTo(page, 0.5);

    const state = await page.evaluate(() => {
      const section = document.getElementById("families-section");
      if (!section) throw new Error("families section not found");
      return {
        inlineY: section.style.getPropertyValue("--families-y"),
        opacities: [...section.querySelectorAll(".fw")].map((el) =>
          Number(getComputedStyle(el).opacity),
        ),
      };
    });

    expect(state.inlineY, "the scrub never wrote --families-y").toBe("");
    expect(state.opacities).toHaveLength(EXPECTED_WORDS.length);
    expect(
      state.opacities.every((o) => o === 1),
      "all words fully revealed",
    ).toBe(true);
  });
});

test.describe("no JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  /**
   * families-section "No-JS presentation": the authored --families-y makes
   * every word full ink with the script dead. (The SSR'd loader/gate
   * overlays also never dismiss without JS — they are not this section's
   * subject.)
   */
  test("the section renders fully revealed and readable", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const state = await page.evaluate(() => {
      const section = document.getElementById("families-section");
      if (!section) throw new Error("families section not found");
      return {
        opacities: [...section.querySelectorAll(".fw")].map((el) =>
          Number(getComputedStyle(el).opacity),
        ),
        text: section.textContent ?? "",
      };
    });

    expect(state.opacities).toHaveLength(EXPECTED_WORDS.length);
    expect(
      state.opacities.every((o) => o === 1),
      "all words fully revealed without JS",
    ).toBe(true);
    for (const word of EXPECTED_WORDS) {
      expect(state.text).toContain(word);
    }
  });
});

test.describe("theme and reveal wiring", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * families-section spec: "Device-theme ink pair" — dark is the authored
   * baseline; emulating light at runtime re-colours through the CSS
   * variables with no reload and no script.
   */
  test("ink pair follows the device scheme, re-colouring live at runtime", async ({ page }) => {
    // Playwright's default colorScheme is light; request the authored
    // baseline explicitly.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const read = () =>
      page.evaluate(() => {
        const section = document.getElementById("families-section");
        const word = document.querySelector("#families-section .fw");
        const divider = document.querySelector(".families-divider");
        if (!section || !word || !divider) throw new Error("families section not found");
        return {
          bg: getComputedStyle(section).backgroundColor,
          ink: getComputedStyle(word).color,
          rule: getComputedStyle(divider).backgroundColor,
        };
      });

    const dark = await read();
    expect(dark.bg, "dark baseline surface").toBe("rgb(10, 10, 10)");
    expect(dark.ink, "white ink on the dark baseline").toBe("rgb(255, 255, 255)");
    expect(dark.rule).not.toBe("none");

    await page.emulateMedia({ colorScheme: "light" });
    const light = await read();
    expect(light.bg, "light surface").toBe("rgb(255, 255, 255)");
    expect(light.ink, "black ink in the light scheme").toBe("rgb(0, 0, 0)");
    expect(light.rule).not.toBe("none");
  });

  /**
   * The per-frame cost stays one style write: a scripted pass through the
   * section counts --families-y writes against rAF frames and confirms the
   * scrub reads no layout geometry. (The spec's FamiliesReveal scrub
   * requirement, instrumentation-form, recorded here as a test so it keeps
   * holding.)
   */
  test("the scrub writes one custom property per frame and reads no layout", async ({ page }) => {
    await page.addInitScript(() => {
      const probe = { writes: 0, frames: 0, rects: 0 };
      (window as unknown as { __probe: typeof probe }).__probe = probe;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          probe.frames++;
          cb(t);
        });
      const origRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        probe.rects++;
        return origRect.call(this);
      };
      const origSet = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (name, value, prio) {
        if (name === "--families-y") probe.writes++;
        return origSet.call(this, name, value, prio);
      };
    });
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    // Measure the scroll targets FIRST so the test's own layout reads are not
    // counted against the scrub (the component itself only reads rects at init).
    const top = await sectionTop(page);
    const vh = await page.evaluate(() => window.innerHeight);
    const baseline = await page.evaluate(
      () =>
        (window as unknown as { __probe: { writes: number; frames: number; rects: number } })
          .__probe,
    );
    for (let i = 0; i <= 10; i++) {
      await page.evaluate(
        (y) => window.scrollTo(0, y),
        Math.max(0, top - vh * (1 - (i / 10) * 1.4)),
      );
      await page.waitForTimeout(60);
    }
    const after = await page.evaluate(
      () =>
        (window as unknown as { __probe: { writes: number; frames: number; rects: number } })
          .__probe,
    );

    const writes = after.writes - baseline.writes;
    const frames = after.frames - baseline.frames;
    // Rect reads are allowed at init (word positions) but not per scroll
    // frame; the gate keeps far-away scrolling write-free.
    expect(writes, `scrub writes (${writes}) exceed frames (${frames})`).toBeLessThanOrEqual(
      frames,
    );
    expect(after.rects - baseline.rects, "no getBoundingClientRect in the scroll path").toBe(0);
  });

  /**
   * The --families-y driver is normalised to the chrome-hidden viewport
   * (lvh), the same unit the repo's scroll choreography uses for anything
   * watched while scrolling down — the scrub must not re-scale when mobile
   * browser chrome collapses.
   */
  test("the reveal units are lvh-based, never dvh/svh", async ({ page }) => {
    await page.goto("/");
    await dismissWelcomeGate(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const css = await page.evaluate(() => {
      const text: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (list: CSSRuleList) => {
          for (const rule of Array.from(list)) {
            const nested = rule as CSSStyleRule & { cssRules?: CSSRuleList };
            if (nested.cssRules && nested.cssRules.length > 0) {
              walk(nested.cssRules);
            } else if (rule.cssText && rule.cssText.includes("families")) {
              text.push(rule.cssText);
            }
          }
        };
        walk(rules);
      }
      return text.join("\n");
    });
    expect(css).toContain("lvh");
    expect(css).not.toContain("svh");
    expect(css).not.toContain("dvh");
  });
});
