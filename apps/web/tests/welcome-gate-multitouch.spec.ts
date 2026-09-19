import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-touch protection for the gate's finger-tracked swipe.
 *
 * `onTouchMove` used to read `event.touches[0]` unconditionally. The touch list
 * is ordered by the platform, not by arrival, so once a second finger is down
 * the drag could start following a contact that never began it — snapping the
 * gate to an unrelated position mid-gesture. The drag now latches the starting
 * finger's `identifier` and ignores every other contact.
 *
 * Touch-primary only: the gate binds `touchstart`/`touchmove`/`touchend` inside
 * `arm()`, and the assertions below are meaningless without a touch context.
 */
const DRAG_PX = 120;

/**
 * Resolves once the gate is present and its gesture listeners are bound.
 *
 * `arm()` runs from a MutationObserver watching for the loader's removal, so
 * the loader being gone is necessary but not sufficient — the callback is a
 * later task. Rather than dispatching a probe gesture (which would consume the
 * drag and leave the gate mid-transition), wait for the observable side effect
 * `arm()` performs first: it locks the document scroll.
 */
async function armedGate(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#welcome-gate");
  await page.waitForFunction(() => !document.getElementById("loading-screen"), null, {
    timeout: 15_000,
  });
  await page.waitForFunction(() => document.documentElement.style.overflow === "hidden", null, {
    timeout: 15_000,
  });
}

test.describe("welcome gate multi-touch", () => {
  test("a reordered touch list cannot hijack a drag in progress", async ({ page, isMobile }) => {
    test.skip(isMobile !== true, "touch-primary behavior");
    await armedGate(page);
    const vp = page.viewportSize()!;

    const result = await page.evaluate(
      ({ x, startY, low, drag }) => {
        const gate = document.getElementById("welcome-gate")!;
        const touch = (identifier: number, clientY: number) =>
          new Touch({ identifier, target: gate, clientX: x, clientY });
        const fire = (type: string, touches: Touch[], changedTouches: Touch[]) =>
          gate.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches,
              targetTouches: touches,
              changedTouches,
            }),
          );
        const offset = (t: string) => (t === "none" ? 0 : Math.round(new DOMMatrixReadOnly(t).m42));
        const now = () => offset(getComputedStyle(gate).transform);

        const first = touch(1, startY);
        const firstMoved = touch(1, startY - drag);
        const second = touch(2, low);

        fire("touchstart", [first], [first]);
        fire("touchmove", [firstMoved], [firstMoved]);
        const dragged = now();

        // A second finger lands; both remain down, but it is listed first.
        fire("touchstart", [firstMoved, second], [second]);
        fire("touchmove", [second, firstMoved], [second]);
        const afterReorder = now();

        // The original finger must STILL steer the drag afterwards. Without
        // this phase, an implementation that simply gave up on multi-touch
        // (ignoring every move once a second finger is down) would pass.
        const firstFurther = touch(1, startY - drag * 2);
        fire("touchmove", [second, firstFurther], [firstFurther]);
        const afterOwnerMoves = now();

        return { dragged, afterReorder, afterOwnerMoves };
      },
      { x: vp.width / 2, startY: vp.height * 0.7, low: vp.height * 0.98, drag: DRAG_PX },
    );

    // Asserted against absolute expected offsets, not against each other: a
    // run where nothing was bound yields 0 for all three, which must fail.
    expect(result.dragged, "the first finger dragged the gate up by ~DRAG_PX").toBeCloseTo(
      -DRAG_PX,
      -1,
    );
    expect(
      result.afterReorder,
      "a reordered list does not snap the gate to the newcomer's position",
    ).toBeCloseTo(-DRAG_PX, -1);
    expect(
      result.afterOwnerMoves,
      "the latched finger still steers the drag once it moves again",
    ).toBeCloseTo(-DRAG_PX * 2, -1);
  });

  test("a stray touchend for an unknown finger cannot commit or wedge the gate", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile !== true, "touch-primary behavior");
    await armedGate(page);
    const vp = page.viewportSize()!;

    const result = await page.evaluate(
      ({ x, startY, drag }) => {
        const gate = document.getElementById("welcome-gate")!;
        const touch = (identifier: number, clientY: number) =>
          new Touch({ identifier, target: gate, clientX: x, clientY });
        const fire = (type: string, touches: Touch[], changedTouches: Touch[]) =>
          gate.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches,
              targetTouches: touches,
              changedTouches,
            }),
          );
        const now = () => {
          const t = getComputedStyle(gate).transform;
          return t === "none" ? 0 : Math.round(new DOMMatrixReadOnly(t).m42);
        };

        const first = touch(1, startY);
        const firstMoved = touch(1, startY - drag);
        fire("touchstart", [first], [first]);
        fire("touchmove", [firstMoved], [firstMoved]);

        // A finger that never began the drag lifts while the owner stays down.
        fire("touchend", [firstMoved], [touch(42, startY)]);
        const afterStrayEnd = now();

        // The owner still drives the gesture.
        const further = touch(1, startY - drag * 2);
        fire("touchmove", [further], [further]);
        const afterOwnerMoves = now();
        return { afterStrayEnd, afterOwnerMoves };
      },
      { x: vp.width / 2, startY: vp.height * 0.7, drag: DRAG_PX },
    );

    expect(result.afterStrayEnd, "a stray lift neither commits nor resets").toBeCloseTo(
      -DRAG_PX,
      -1,
    );
    expect(
      result.afterOwnerMoves,
      "the gesture is not wedged — the owning finger still steers",
    ).toBeCloseTo(-DRAG_PX * 2, -1);
  });
});
