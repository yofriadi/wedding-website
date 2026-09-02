// The <story-viewer> custom element.
//
// This lives in its OWN module rather than inside StoryViewer.astro's
// <script> because of how Astro ships component scripts: they are emitted only
// for components that actually RENDER. story-rail-attribution D6 made the
// component render on an EMPTY wall only (three mock tiles) — so on a
// non-empty wall the page used to ship no definition at all, and the tiles
// that scripts/guest-rail.ts injects client-side stayed inert markup: named
// and thumbnailed, but with no openStory/closeStory, no portal, no listeners
// (the tile's own invisible closed modal even swallowed clicks, because a
// non-portaled modal resolves `position: fixed` against the tile wrapper's
// fade-up transform and its pointer-events-auto nav buttons land on the tile).
//
// guest-rail.ts therefore imports this module directly, so the element is
// defined on every page that builds rail tiles; StoryViewer.astro imports it
// too, so a page that renders the component stays self-sufficient. Vite
// dedupes the two into one chunk and the customElements.get() guard below
// makes a double import a no-op.
//
// Everything here is browser-only: the module reads window.matchMedia at
// import time and is never imported from server code.

import { animate } from "motion";
// story-rail-attribution D5: shared with scripts/guest-rail.ts so a
// client-built guest tile formats its `createdAt` exactly like this modal
// formats an SSR `timestamp` prop.
import { formatRelativeTime } from "../lib/time";

// JS twin of the CSS --ease-out-expo token; keep in sync.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

// Read once at module scope; drives fade-only branches below.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface OpenStoryOptions {
  animate?: boolean;
  startIndex?: number | "last";
  onFirstSlideReady?: () => void;
}

const DEFAULT_IMAGE_DURATION = 5000;

// Custom element (guest-submissions 4.3): the rail inserts guest tiles
// dynamically after POST /api/submissions, and index.astro's orchestrator
// is an is:inline script in a SEPARATE global scope — it cannot call into
// this bundled module. Defining <story-viewer> makes init self-driven and
// idempotent: connectedCallback fires on insertion (both at page load for
// demo tiles and at runtime for dynamically appended guest tiles).
if (!customElements.get("story-viewer")) {
  class StoryViewerElement extends HTMLElement {
    openStory: (options?: OpenStoryOptions) => void = () => {};
    closeStory: (options?: { animate?: boolean }) => void = () => {};

    connectedCallback(): void {
      this.init();
    }

    disconnectedCallback(): void {
      // story-rail-mocks D3: tile removal must be side-effect-free. Force
      // close first (clears the progress interval and restores body scroll;
      // closeStory's !isOpen early-return makes a never-opened tile a
      // no-op), then remove the body-portaled modal. Both handles are
      // null-tolerant for tiles whose init() bailed early.
      this.closeStory({ animate: false });
      this.#modal?.remove();
      if (this.#keydownHandler) {
        window.removeEventListener("keydown", this.#keydownHandler);
        this.#keydownHandler = undefined;
      }
    }

    #keydownHandler: ((e: KeyboardEvent) => void) | undefined;
    #modal: HTMLElement | undefined;

    private init(): void {
      // Second connect after an insert/remove cycle: the modal may already
      // be portaled to body and listeners attached — init once per element.
      if (this.dataset.initialized === "true") return;
      this.dataset.initialized = "true";
      const viewer = this;
      const storiesScript = viewer.querySelector("[data-stories]");
      if (!storiesScript) return;

      let stories: any[] = [];
      try {
        const content = storiesScript.textContent?.trim() || "[]";
        stories = JSON.parse(content);
      } catch (e) {
        console.error("StoryViewer JSON parse error:", e, storiesScript.textContent);
        return;
      }

      if (!Array.isArray(stories) || stories.length === 0) return;

      const modal = viewer.querySelector("[data-modal]") as HTMLElement;
      const panel = viewer.querySelector("[data-panel]") as HTMLElement;
      const openButton = viewer.querySelector("[data-open]") as HTMLButtonElement;
      const closeButton = viewer.querySelector("[data-close]") as HTMLButtonElement;
      const nextButton = viewer.querySelector("[data-next]") as HTMLButtonElement;
      const prevButton = viewer.querySelector("[data-prev]") as HTMLButtonElement;
      const spinner = viewer.querySelector("[data-spinner]") as HTMLElement;
      const stage = viewer.querySelector("[data-stage]") as HTMLElement;
      const usernameEl = viewer.querySelector("[data-username]");
      const timestampEl = viewer.querySelector("[data-timestamp]");
      const avatarImg = modal.querySelector("[data-avatar]") as HTMLImageElement | null;
      const progressBars = Array.from(
        viewer.querySelectorAll("[data-progress-bar]"),
      ) as HTMLElement[];

      if (!modal || !panel || !openButton || !closeButton || !stage) return;

      // Portal modal to body
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      // story-rail-mocks D3: keep the portaled modal reachable from
      // disconnectedCallback (querySelector can't see it after the portal).
      this.#modal = modal;

      let currentIndex = 0;
      let isOpen = false;
      let isPaused = false;
      let progressTimer: number | null = null;
      let pauseOffset = 0;
      let pauseStarted = 0;
      let startTime = 0;
      let firstSlideNotified = false;
      let pendingFirstSlideReady: (() => void) | undefined;

      // Slide management
      let currentSlideEl: HTMLElement | null = null;

      const viewedIndices = new Set<number>();

      function updateTimestamp() {
        if (!timestampEl) return;
        const raw = timestampEl.getAttribute("data-value");
        if (!raw) {
          timestampEl.textContent = "";
          return;
        }
        timestampEl.textContent = formatRelativeTime(raw);
      }

      // Past/future segment states are written once per index change; the 50ms
      // progress tick writes only the active bar, and only via transform.
      function updateSegmentStates() {
        progressBars.forEach((bar, index) => {
          if (!bar) return;
          bar.style.transform = index < currentIndex ? "scaleX(1)" : "scaleX(0)";
        });
      }

      function setProgress(value: number) {
        const bar = progressBars[currentIndex];
        if (!bar) return;
        bar.style.transform = `scaleX(${value / 100})`;
      }

      function clearProgress() {
        if (progressTimer) {
          window.clearInterval(progressTimer);
          progressTimer = null;
        }
      }

      function showSpinner() {
        if (spinner) {
          spinner.classList.remove("hidden");
          if (reducedMotion) {
            animate(spinner, { opacity: [0, 1] }, { duration: 0.15 });
          } else {
            animate(spinner, { opacity: [0, 1], scale: [0.8, 1] }, { duration: 0.15 });
          }
        }
      }

      function hideSpinner() {
        if (spinner) {
          const keyframes = reducedMotion
            ? { opacity: [1, 0] }
            : { opacity: [1, 0], scale: [1, 0.8] };
          animate(spinner, keyframes, { duration: 0.12 }).finished.then(() => {
            spinner.classList.add("hidden");
          });
        }
      }

      function pause() {
        if (isPaused) return;
        isPaused = true;
        pauseStarted = performance.now();
        // Paused badge removed
      }

      function resume() {
        if (!isPaused) return;
        isPaused = false;
        pauseOffset += performance.now() - pauseStarted;
        // Paused badge removed
      }

      function startImageProgress(duration: number) {
        clearProgress();
        pauseOffset = 0;
        startTime = performance.now();
        setProgress(0);
        progressTimer = window.setInterval(() => {
          if (isPaused) return;
          const elapsed = performance.now() - startTime - pauseOffset;
          const nextProgress = Math.min((elapsed / duration) * 100, 100);
          setProgress(nextProgress);
          if (nextProgress >= 100) {
            goToNext();
          }
        }, 50);
      }

      function updateNav() {
        if (prevButton instanceof HTMLButtonElement) {
          prevButton.disabled = currentIndex === 0;
          prevButton.style.opacity = currentIndex === 0 ? "0.5" : "1";
          prevButton.style.cursor = currentIndex === 0 ? "not-allowed" : "pointer";
        }
      }
      // Script-scope twin of the frontmatter isStaticWebp: the inline client
      // bundle cannot import frontmatter consts.
      const isStaticWebpAsset = (src: string) =>
        src.startsWith("/") && !src.startsWith("/api/") && src.endsWith(".webp");

      function createSlideElement(story: any) {
        const picture = document.createElement("picture");
        const img = document.createElement("img");
        img.src = story.src;
        // Prefer the AVIF sidecar for static assets; guest uploads have none.
        if (isStaticWebpAsset(story.src)) {
          const avif = document.createElement("source");
          avif.srcset = story.src.replace(/\.webp$/, ".avif");
          avif.type = "image/avif";
          const webp = document.createElement("source");
          webp.srcset = story.src;
          webp.type = "image/webp";
          picture.append(avif, webp);
        }
        img.className = "absolute inset-0 w-full h-full object-contain opacity-0";
        picture.className = "absolute inset-0 w-full h-full";
        picture.append(img);
        img.onload = () => {
          // story-rail-mocks D3: a removed (or closed-then-detached) viewer
          // must never resurrect a progress timer from a late image load —
          // and a STALE slide (user navigated away before it finished
          // loading) must not start the current slide's progress with its
          // own duration or signal first-slide readiness early.
          if (!viewer.isConnected || !isOpen || currentSlideEl !== picture) return;
          hideSpinner();
          img.classList.remove("opacity-0");
          // Opacity-only reveal (D8): a cold-loading first slide fades in over
          // the spinner instead of hard-cutting. Opacity fade is reduced-motion-safe.
          animate(img, { opacity: [0, 1] }, { duration: 0.15 });
          const duration = story.duration || DEFAULT_IMAGE_DURATION;
          startImageProgress(duration);
          // Readiness signal for viewer-to-viewer hand-off; fires once per open session.
          if (!firstSlideNotified) {
            firstSlideNotified = true;
            viewer.dispatchEvent(new CustomEvent("story-first-slide-ready", { bubbles: true }));
            pendingFirstSlideReady?.();
            pendingFirstSlideReady = undefined;
          }
        };
        return picture;
      }

      function setStory(index: number, direction: number = 0) {
        clearProgress();
        currentIndex = index;

        const story = stories[currentIndex];
        viewedIndices.add(currentIndex);
        updateSegmentStates();
        updateNav();

        // The modal is portaled to <body>, so viewer.querySelector() can no
        // longer see [data-username] — re-querying here used to CLEAR the
        // author name on every story change (guest + demo + mock alike).
        // The viewer element itself carries data-username={username}; that
        // attribute is portal-proof.
        if (usernameEl) {
          usernameEl.textContent = viewer.getAttribute("data-username") || usernameEl.textContent;
        }

        showSpinner();

        // Create new slide
        const newSlide = createSlideElement(story);

        if (direction !== 0) {
          // Seat the incoming slide at its off-screen start before append, so no
          // "loaded" frame flashes mid-stage if the image decodes instantly.
          if (!reducedMotion) {
            newSlide.style.transform = direction > 0 ? "translateX(100%)" : "translateX(-100%)";
          }
          stage.appendChild(newSlide);

          if (reducedMotion) {
            // Cross-fade in place: keep opacity feedback, drop the slide.
            animate(newSlide, { opacity: [0, 1] }, { duration: 0.15 });

            if (currentSlideEl) {
              const oldSlide = currentSlideEl;
              animate(oldSlide, { opacity: [1, 0] }, { duration: 0.15 }).finished.then(() => {
                oldSlide.remove();
              });
            }
          } else {
            // Full transform keyframes ride the accelerated path (not the
            // main-thread x shorthand); opacity cross-fades underneath so the
            // outgoing slide never teleports out from behind the incoming one.
            animate(
              newSlide,
              {
                opacity: [0, 1],
                transform: [
                  direction > 0 ? "translateX(100%)" : "translateX(-100%)",
                  "translateX(0%)",
                ],
              },
              { duration: 0.2, ease: EASE_OUT_EXPO },
            );

            // Animate out old slide
            if (currentSlideEl) {
              const oldSlide = currentSlideEl;
              animate(
                oldSlide,
                {
                  opacity: [1, 0],
                  transform: [
                    "translateX(0%)",
                    direction > 0 ? "translateX(-100%)" : "translateX(100%)",
                  ],
                },
                { duration: 0.2, ease: EASE_OUT_EXPO },
              ).finished.then(() => {
                oldSlide.remove();
              });
            }
          }
        } else {
          // Immediate / Fade (first load)
          stage.appendChild(newSlide);
          if (currentSlideEl) currentSlideEl.remove();
        }

        currentSlideEl = newSlide;
      }

      function goToNext() {
        if (currentIndex < stories.length - 1) {
          setStory(currentIndex + 1, 1);
        } else {
          const event = new CustomEvent("story-viewer-end", { bubbles: true, cancelable: true });
          const allowed = viewer.dispatchEvent(event);
          if (allowed) {
            close();
          }
        }
      }

      function goToPrev() {
        if (currentIndex > 0) {
          setStory(currentIndex - 1, -1);
        } else {
          // Mirror of story-viewer-end: lets the orchestrator hand off to the
          // previous viewer; when cancelled, this viewer stays put.
          const event = new CustomEvent("story-viewer-prev", { bubbles: true, cancelable: true });
          const allowed = viewer.dispatchEvent(event);
          if (allowed) {
            setProgress(0);
          }
        }
      }

      function open(options: OpenStoryOptions = {}) {
        if (isOpen) return;
        isOpen = true;
        // The modal is portaled to <body>, outside every [data-progressive-section],
        // so the section preloader never reaches this img — hydrate on first open.
        if (avatarImg?.dataset.src) {
          avatarImg
            .closest("picture")
            ?.querySelectorAll<HTMLSourceElement>("source[data-src]")
            .forEach((source) => {
              source.src = source.dataset.src!;
              source.removeAttribute("data-src");
            });
          avatarImg.src = avatarImg.dataset.src;
          avatarImg.removeAttribute("data-src");
        }
        const { animate: shouldAnimate = true, startIndex, onFirstSlideReady } = options;
        firstSlideNotified = false;
        pendingFirstSlideReady = onFirstSlideReady;
        modal.classList.remove("pointer-events-none");
        modal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";

        if (shouldAnimate) {
          animate(modal, { opacity: [0, 1] }, { duration: 0.15 });
          if (reducedMotion) {
            // Fade-only: no scale/y movement under reduced motion.
            panel.style.transform = "none";
            animate(panel, { opacity: [0, 1] }, { duration: 0.15 });
          } else {
            animate(
              panel,
              {
                opacity: [0, 1],
                transform: ["translateY(16px) scale(0.95)", "translateY(0px) scale(1)"],
              },
              { duration: 0.2, ease: EASE_OUT_EXPO },
            );
          }
        } else {
          modal.style.opacity = "1";
          panel.style.opacity = "1";
          panel.style.transform = "none";
        }

        // Resolve the opening story index: explicit startIndex wins, then the
        // first unviewed story, falling back to 0.
        let startIdx: number;
        if (startIndex === "last") {
          startIdx = stories.length - 1;
        } else if (typeof startIndex === "number") {
          startIdx = Math.min(Math.max(startIndex, 0), stories.length - 1);
        } else {
          startIdx = stories.findIndex((_: any, i: number) => !viewedIndices.has(i));
          if (startIdx === -1) startIdx = 0;
        }

        setStory(startIdx, 0); // 0 direction = no slide
      }

      function close(options: { animate?: boolean } = {}) {
        const shouldAnimate = options.animate ?? true;
        if (!isOpen) return;
        isOpen = false;
        pendingFirstSlideReady = undefined;
        clearProgress();
        if (currentSlideEl instanceof HTMLVideoElement) {
          currentSlideEl.pause();
        }

        const onComplete = () => {
          modal.classList.add("pointer-events-none");
          modal.setAttribute("aria-hidden", "true");
          // story-rail-mocks hand-off: another viewer's modal may still be
          // open (the outgoing viewer closes only after the incoming one is
          // up) — releasing the body scroll lock here would unlock the page
          // under a still-open story. Only release when none remains.
          if (!document.querySelector('[data-modal][aria-hidden="false"]')) {
            document.body.style.overflow = "";
          }
          if (currentSlideEl) {
            currentSlideEl.remove();
            currentSlideEl = null;
          }
        };

        if (shouldAnimate) {
          animate(modal, { opacity: [1, 0] }, { duration: 0.12 }).finished.then(onComplete);
          // Exits ease-out and run faster than entrances: the exit confirms an
          // action the user already took.
          if (reducedMotion) {
            animate(panel, { opacity: [1, 0] }, { duration: 0.12 });
          } else {
            animate(
              panel,
              {
                opacity: [1, 0],
                transform: ["translateY(0px) scale(1)", "translateY(12px) scale(0.95)"],
              },
              { duration: 0.12, ease: EASE_OUT_EXPO },
            );
          }
        } else {
          modal.style.opacity = "0";
          onComplete();
        }
      }

      // Expose methods for external orchestration (index.astro's is:inline
      // orchestrator reads these off the element).
      this.openStory = open;
      this.closeStory = close;

      // Event Listeners
      openButton.addEventListener("click", () => {
        updateTimestamp();
        open();
      });

      closeButton.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
      });

      nextButton?.addEventListener("click", (e) => {
        e.stopPropagation();
        goToNext();
      });

      prevButton?.addEventListener("click", (e) => {
        e.stopPropagation();
        goToPrev();
      });

      // Gestures
      let isPressed = false;
      let pressStartTime = 0;

      stage.addEventListener("pointerdown", () => {
        isPressed = true;
        pressStartTime = Date.now();
        pause();
      });

      stage.addEventListener("pointerup", (e) => {
        if (!isPressed) return;
        isPressed = false;
        resume();

        const duration = Date.now() - pressStartTime;
        if (duration < 250) {
          // Tap
          const rect = stage.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          if (clickX < rect.width / 2) {
            goToPrev();
          } else {
            goToNext();
          }
        }
      });

      stage.addEventListener("pointerleave", () => {
        if (isPressed) {
          isPressed = false;
          resume();
        }
      });

      const keydownHandler = (e: KeyboardEvent) => {
        if (!isOpen) return;
        switch (e.key) {
          case "ArrowLeft":
            goToPrev();
            break;
          case "ArrowRight":
            goToNext();
            break;
          case "Escape":
            close();
            break;
          case " ":
            e.preventDefault();
            if (isPaused) {
              resume();
            } else {
              pause();
            }
            break;
        }
      };
      this.#keydownHandler = keydownHandler;
      window.addEventListener("keydown", keydownHandler);

      updateTimestamp();
    }
  }

  customElements.define("story-viewer", StoryViewerElement);
}
