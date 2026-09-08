// Story rail guest tiles (guest-submissions 3.4/3.5 + 4.1 tile visibility).
//
// For everyone: renders guest photo tiles as <story-viewer> custom elements,
// each labelled with the poster's FIRST NAME (story-rail-attribution D3/D4 —
// the wall is public, so every visitor class sees the same attribution),
// serves the rail THUMBNAILS (not originals — egress control L6), lazy-loads
// them, caps the rail to the N most recent submissions, and owns the
// add-story tile visibility (visible only when a cookie is present AND `mine`
// is null). Anonymous callers get `mine: null` from the public wall
// (public-wall D2), so they render wall tiles with no add-story tile.

import {
  loadSubmissions,
  SUBMISSION_POSTED_EVENT,
  type SubmissionsPayload,
  type SubmissionPhoto,
} from "../lib/submissions-client";
// story-rail-attribution D5: the same formatter StoryViewer's modal uses, so a
// client-built tile's relative timestamp matches an SSR tile's exactly.
import { formatRelativeTime } from "../lib/time";

// The tiles built below are <story-viewer> custom elements, and their
// definition can NOT be relied on from StoryViewer.astro's own script: Astro
// ships a component's script only when that component RENDERS, which on a
// non-empty wall (D6 — SSR renders mocks only) it never does. Importing the
// definition here is what keeps client-injected tiles interactive instead of
// inert markup. See the module header for the full failure mode.
import "./story-viewer-element";
import { openAddStoryFlow } from "./add-story-flow";

const WALL_TILE_CAP = 30; // wall slice only — the rail's full budget is mocks (3, empty wall only) + wall (30) + own (1)

// What a tile needs to name its poster. Both fields are optional AT THE
// BOUNDARY: a payload from an older server (or a test fixture that omits them)
// degrades to the attribution-free tile instead of rendering "undefined".
interface TileAttribution {
  firstName?: string | null;
  createdAt?: number | null;
}

// The modal's timestamp element carries `data-value`, which StoryViewer
// re-parses on open via `new Date(value)`. Epoch ms must therefore travel as
// an ISO string: `new Date("1730000000000")` is an Invalid Date while
// `new Date(1730000000000)` is not. Anything unusable yields null and the
// author header renders name-only.
function toTimestampValue(createdAt: number | null | undefined): string | null {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const TILE_WIDTH = 112;

function findRail(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-story-rail]");
}

function tileWrapper(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "snap-center flex-shrink-0 animate-fade-up";
  return div;
}

// Build one guest tile as a <story-viewer> custom element. The component's own
// connectedCallback (StoryViewer.astro) self-initializes it on insertion — no
// cross-module call needed — so this markup must mirror the component's:
// same label span, same data-* hooks, same author-header shape.
function buildGuestTile(
  photos: SubmissionPhoto[],
  attribution: TileAttribution = {},
): HTMLElement | null {
  if (photos.length === 0) return null;

  const firstName = attribution.firstName ?? null;
  const accessibleLabel = firstName ? `View ${firstName}'s stories` : "View guest story";

  const viewer = document.createElement("story-viewer");
  viewer.className = "story-viewer";
  viewer.setAttribute("data-story-viewer", "");
  viewer.setAttribute("data-guest", "true");
  viewer.setAttribute("data-label", accessibleLabel);
  // data-username belongs on the ELEMENT, not only inside the modal: the
  // modal is portaled to <body>, and the component re-reads this attribute on
  // every slide change because querySelector can no longer see the name span.
  if (firstName) {
    viewer.setAttribute("data-username", firstName);
  }

  const storiesJson = document.createElement("script");
  storiesJson.type = "application/json";
  storiesJson.setAttribute("data-stories", "");
  storiesJson.textContent = JSON.stringify(
    photos.map((p, i) => ({ id: `guest-${i}`, type: "image", src: p.photoUrl, duration: 5000 })),
  );
  viewer.appendChild(storiesJson);

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-open", "");
  button.className =
    "relative flex flex-col items-center gap-2 group cursor-pointer bg-transparent border-none outline-none active:scale-[0.97] transition-transform duration-160 ease-out";
  button.setAttribute("aria-label", accessibleLabel);

  const frame = document.createElement("div");
  frame.className = "relative";
  frame.style.width = `${TILE_WIDTH}px`;
  frame.style.height = "200px";

  const inner = document.createElement("div");
  inner.className =
    "absolute inset-0 rounded-[12px] overflow-hidden bg-[color:var(--memories-frame)] ring-1 ring-[color:var(--memories-frame-ring)]";

  const img = document.createElement("img");
  // Egress control (L6): the rail tile renders the thumbnail, never a full
  // original; lazy + async so off-screen tiles never fetch at all.
  img.src = photos[0]?.thumbnailUrl ?? "";
  img.alt = firstName ? `${firstName}'s story` : "Guest story";
  img.width = 224;
  img.height = 400;
  img.loading = "lazy";
  img.decoding = "async";
  img.className = "zoom-cover w-full h-full object-cover";
  inner.appendChild(img);

  frame.appendChild(inner);
  button.appendChild(frame);

  // The label row always renders so every tile holds the same rail geometry:
  // the poster's first name when there is one (ellipsised at 80px, full token
  // in the modal header), otherwise the transparent filler span.
  const labelSpan = document.createElement("span");
  if (firstName) {
    labelSpan.className = "text-xs text-[color:var(--memories-label)] truncate max-w-[80px]";
    labelSpan.textContent = firstName;
  } else {
    labelSpan.className = "text-xs text-transparent truncate max-w-[80px]";
    labelSpan.setAttribute("aria-hidden", "true");
    labelSpan.textContent = ".";
  }
  button.appendChild(labelSpan);

  viewer.appendChild(button);

  // The modal markup mirrors the component's, author header included.
  viewer.appendChild(buildGuestModal(photos, firstName, attribution.createdAt ?? null));
  return viewer;
}

function buildGuestModal(
  photos: { photoUrl: string }[],
  firstName: string | null,
  createdAt: number | null,
): HTMLElement {
  const modal = document.createElement("div");
  modal.setAttribute("data-modal", "");
  modal.className =
    "fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center opacity-0 pointer-events-none";
  modal.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.setAttribute("data-panel", "");
  panel.className =
    "relative w-full h-full max-w-lg mx-auto flex flex-col overflow-hidden bg-black/90";

  const header = document.createElement("div");
  header.className =
    "absolute top-0 left-0 right-0 z-20 pt-2 pb-4 bg-gradient-to-b from-black/70 to-transparent";

  const segments = document.createElement("div");
  segments.className = "flex gap-1 w-full px-2";
  photos.forEach((_, index) => {
    const seg = document.createElement("div");
    seg.className = "flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden";
    seg.setAttribute("data-progress-item", "");
    seg.setAttribute("data-index", String(index));

    const bar = document.createElement("div");
    bar.className = "h-full bg-white rounded-full w-full";
    bar.setAttribute("data-progress-bar", "");
    bar.style.transform = "scaleX(0)";
    bar.style.transformOrigin = "left";
    seg.appendChild(bar);
    segments.appendChild(seg);
  });
  header.appendChild(segments);

  const row = document.createElement("div");
  row.className = "flex items-center justify-between px-4 mt-3";

  // Author header (story-rail-attribution D4): first name + relative time,
  // with NO avatar circle — a guest tile has no avatar, and inventing one
  // (initials, or the first photo) would read as a profile photo. A null
  // firstName keeps the attribution-free placeholder instead.
  if (firstName) {
    const author = document.createElement("div");
    author.className = "flex items-center gap-3";

    const column = document.createElement("div");
    column.className = "flex flex-col";

    const name = document.createElement("span");
    name.className = "text-white text-sm font-medium";
    name.setAttribute("data-username", "");
    name.textContent = firstName;
    column.appendChild(name);

    const timestampValue = toTimestampValue(createdAt);
    if (timestampValue !== null) {
      const time = document.createElement("span");
      time.className = "text-white/60 text-xs";
      time.setAttribute("data-timestamp", "");
      // data-value stays an ISO STRING: the component re-parses it on open,
      // and a bare epoch-ms string is an Invalid Date to `new Date(string)`.
      time.setAttribute("data-value", timestampValue);
      time.textContent = formatRelativeTime(createdAt);
      column.appendChild(time);
    }

    author.appendChild(column);
    row.appendChild(author);
  } else {
    // Unnamed tile (null firstName): an empty attribution slot, no placeholder
    // text (retire-wishes-story-intro D7). The span stays as a zero-width flex
    // child so `justify-between` keeps the close button right-aligned; parity
    // with StoryViewer.astro's empty SSR slot.
    const label = document.createElement("span");
    label.className = "text-white/60 text-xs";
    label.setAttribute("aria-hidden", "true");
    row.appendChild(label);
  }

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("data-close", "");
  closeButton.className =
    "inline-flex items-center justify-center rounded-md h-10 w-10 text-white hover:bg-white/20 active:scale-[0.97] transition-transform duration-160 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 cursor-pointer";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.innerHTML =
    '<svg viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><path fill="currentColor" d="m6 6 12 12m0-12-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
  row.appendChild(closeButton);
  header.appendChild(row);
  panel.appendChild(header);

  const stage = document.createElement("div");
  stage.className =
    "flex-1 flex items-center justify-center overflow-hidden select-none relative w-full h-full";
  stage.setAttribute("data-stage", "");

  const spinner = document.createElement("div");
  spinner.className = "absolute inset-0 flex items-center justify-center z-10 hidden";
  spinner.setAttribute("data-spinner", "");
  spinner.innerHTML =
    '<svg class="android-spinner" viewBox="0 0 50 50" aria-hidden="true"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle></svg>';
  stage.appendChild(spinner);
  panel.appendChild(stage);

  const nav = document.createElement("div");
  nav.className =
    "hidden md:flex absolute inset-y-0 left-0 right-0 items-center justify-between pointer-events-none px-4 z-20";
  const prev = navButton("data-prev", "Previous story", "m15 6-6 6 6 6");
  const next = navButton("data-next", "Next story", "m9 6 6 6-6 6");
  nav.append(prev, next);
  panel.appendChild(nav);

  modal.appendChild(panel);
  return modal;
}

function navButton(attr: string, label: string, path: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(attr, "");
  button.className =
    "inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-[0.97] transition-transform duration-160 ease-out pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 cursor-pointer";
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" class="w-6 h-6" aria-hidden="true"><path fill="currentColor" d="${path}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  return button;
}

function syncAddStoryTile(visible: boolean): void {
  const root = document.querySelector<HTMLElement>("[data-add-story-root]");
  if (!root) return;
  root.classList.toggle("hidden", !visible);
}

// One render path for initial load AND submissions:posted (story-rail-mocks
// D2): clear existing guest tiles, then append the wall (capped) followed by
// the caller's own tile when it has photos. Clear-then-render is idempotent,
// so no rendered flag is needed. Every tile carries its entry's attribution
// (story-rail-attribution D3) — wall stories and `mine` alike.
function renderGuestTiles(data: SubmissionsPayload): void {
  const rail = findRail();
  if (!rail) return;

  rail.querySelectorAll("[data-guest]").forEach((el) => el.parentElement?.remove());

  const stories = data.wall.stories.slice(0, WALL_TILE_CAP);
  for (const story of stories) {
    appendGuestTile(rail, story.photos, story);
  }
  if (data.mine && data.mine.photos.length > 0) {
    appendGuestTile(rail, data.mine.photos, data.mine);
  }
}

function appendGuestTile(
  rail: HTMLElement,
  photos: SubmissionPhoto[],
  attribution: TileAttribution,
): void {
  const tile = buildGuestTile(photos, attribution);
  if (!tile) return;
  const w = tileWrapper();
  w.appendChild(tile);
  rail.appendChild(w);
}

// Adversarial-review fix: the initial GET and the post-submit re-sync apply
// state independently. A slow initial GET resolving after a POST's re-sync
// would clobber the fresh render (tiles cleared, add-story tile back). A
// monotonic generation guard ensures only the latest request applies.
let submissionsGeneration = 0;

function applySubmissionsState(data: SubmissionsPayload): void {
  // Tile visibility (add-story-flow spec): a RESOLVED invite (server-side
  // check, inviteValid) AND no prior submission. Shape-only cookie checks
  // used to pass here — but a STALE well-shaped cookie (deleted invite,
  // reset DB) must not keep a dead posting affordance visible: the flow
  // would open and every submit would 403. inviteValid is the server's
  // word that posting can actually succeed.
  syncAddStoryTile(data.inviteValid === true && data.mine === null);
  renderGuestTiles(data);
  syncMockTiles(data);
}

async function initGuestRailState(): Promise<void> {
  const generation = ++submissionsGeneration;
  const data = await loadSubmissions();
  if (!data) {
    // A newer request owns the state: only the earliest failure should
    // degrade the tile (fetch failed → identity unverified → hide).
    if (generation === submissionsGeneration) syncAddStoryTile(false);
    return;
  }
  if (generation !== submissionsGeneration) return; // stale — a POST re-sync won
  applySubmissionsState(data);
}

// Persistent, per-browser flag: the add-story tile's first activation plays
// the example-story intro; every later tap opens the flow directly
// (retire-wishes-story-intro D4). The flag is set only when the intro
// actually plays — a tap while the three mock tiles still occupy the rail
// skips it unmarked (they ARE the intro content, tappable in place), so the
// first tap AFTER real posts evicted the mocks still gets it.
const STORY_INTRO_SEEN_KEY = "ww-story-intro-seen";

function introSeen(): boolean {
  try {
    return localStorage.getItem(STORY_INTRO_SEEN_KEY) === "1";
  } catch {
    // Private mode / storage disabled: treat as unseen. The intro may replay,
    // but it never blocks opening the flow.
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(STORY_INTRO_SEEN_KEY, "1");
  } catch {
    // Non-fatal: see introSeen().
  }
}

// Find the always-present, hidden example-story viewer (index.astro renders it
// outside [data-story-rail] so it survives mock eviction and never joins rail
// hand-off).
function findIntroViewer(): (HTMLElement & { openStory?: (o?: unknown) => void }) | null {
  return document.querySelector("[data-story-intro] [data-story-viewer]");
}

// First tap plays the intro, then opens the flow when the last example ends;
// every later tap opens the flow directly (retire-wishes-story-intro D4/D5).
// The intro is also skipped while any mock tile still sits in the rail:
// replaying the three examples fullscreen would duplicate what is already
// visible and tappable right there. It only serves a purpose once real posts
// have evicted the mocks, so this skip does NOT mark the intro seen.
function wireTileOpen(): void {
  const openButton = document.querySelector<HTMLElement>("[data-add-story-open]");
  if (!openButton) return;
  openButton.addEventListener("click", () => {
    const intro = findIntroViewer();
    // Mock tiles carry data-mock; the hidden intro viewer never does.
    const mocksInRail = document.querySelector("[data-story-rail] [data-mock]") !== null;
    if (introSeen() || mocksInRail || !intro || typeof intro.openStory !== "function") {
      openAddStoryFlow();
      return;
    }

    // Mark seen on OPEN (the literal "first time they tap it"): bailing out
    // early still counts, so the flow is never gated behind watching it twice.
    markIntroSeen();

    // Hand off to the flow only when the intro plays THROUGH to the end. The
    // viewer dispatches a cancelable `story-viewer-end` when its last slide
    // finishes; the rail-scoped orchestrator (index.astro) ignores this viewer,
    // so we cancel the event ourselves to stop the viewer's own animated close,
    // then close instantly and open the flow. Doing both synchronously avoids a
    // scroll-lock race: the animated close's async onComplete would release
    // document.body.overflow ~120ms later, after the flow (not a [data-modal])
    // already re-locked it. Escape/close before the end never fires this event,
    // so bailing out does NOT open the flow.
    const onIntroEnd = (e: Event) => {
      e.preventDefault();
      const viewer = intro as HTMLElement & { closeStory?: (o?: { animate?: boolean }) => void };
      viewer.closeStory?.({ animate: false });
      openAddStoryFlow();
    };
    intro.addEventListener("story-viewer-end", onIntroEnd, { once: true });

    intro.openStory();
  });
}

// After a successful POST: re-render from the fresh payload (invalidate +
// reload inside loadSubmissions' cache) so the rail reflects the true state
// — all wall tiles plus the caller's own, not the caller's alone.
function onPosted(): void {
  const generation = ++submissionsGeneration;
  void loadSubmissions().then((data) => {
    if (!data) return;
    if (generation !== submissionsGeneration) return; // superseded by a newer sync
    applySubmissionsState(data);
  });
}

// story-rail-mocks D6 + public-wall D2: live mock eviction — every visitor
// runs this now (all fetch the payload). Any real story — the wall's or the
// caller's own — removes every SSR mock tile, wrapper and all, through the
// leak-free disconnect path. Submissions are photo-only
// (retire-wishes-story-intro), so any submission has photos and evicts mocks;
// the always-present example intro carries no data-mock and is never touched.
function syncMockTiles(data: SubmissionsPayload): void {
  if (data.wall.stories.length > 0 || (data.mine?.photos.length ?? 0) > 0) {
    document.querySelectorAll("[data-mock]").forEach((el) => el.parentElement?.remove());
  }
}

export function initGuestRail(): void {
  wireTileOpen();
  void initGuestRailState();
  window.addEventListener(SUBMISSION_POSTED_EVENT, onPosted);
}
