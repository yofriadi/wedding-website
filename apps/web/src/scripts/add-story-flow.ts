// Add-story flow client logic (guest-submissions 4.1/D5).
//
// Wired by index.astro. The modal lives in AddStoryFlow.astro; this module
// owns open/close, client-side pre-validation, submit, and the post-submit
// state transition (tile removal + surfaces re-sync via submissions:posted).

import { animate } from "motion";

import { invalidateSubmissions, SUBMISSION_POSTED_EVENT } from "../lib/submissions-client";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const WISH_MAX = 30;

// JS twin of the CSS --ease-out-expo token; keep in sync.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

// Rotating wish placeholder (story-rail-mocks D7): writing prompts for the
// empty input while the flow is open. One pass per open, then settle on the
// default; the first keystroke disables rotation for the whole page session.
// Every template must stay within the 30-char wish limit (WISH_MAX) —
// suggesting an untypeable wish would be a lie.
const DEFAULT_WISH_PLACEHOLDER = "Write a wish…";
const WISH_PLACEHOLDER_TEMPLATES = [
  "Happy ever after! ✨",
  "To a lifetime of joy!",
  "May love always find you",
  "Grow old together 💛",
  "Selamat menempuh hidup baru!",
  "Bahagia selalu, kalian!",
];
const WISH_PLACEHOLDER_INTERVAL_MS = 4000;

interface FlowElements {
  root: HTMLElement;
  panel: HTMLElement;
  openButtons: HTMLElement[];
  cancelButton: HTMLButtonElement;
  form: HTMLFormElement;
  wishInput: HTMLInputElement;
  wishCount: HTMLElement;
  wishError: HTMLElement;
  photoInput: HTMLInputElement;
  photoError: HTMLElement;
  photoList: HTMLElement;
  photoClear: HTMLButtonElement;
  formError: HTMLElement;
  submitButton: HTMLButtonElement;
  submitLabel: HTMLElement;
  spinner: HTMLElement;
}

let els: FlowElements | null = null;
let selectedFiles: File[] = [];
// Object URLs for the live previews; revoked on each re-render (leak guard).
let previewUrls: string[] = [];
let submitting = false;

// Placeholder rotation state (story-rail-mocks D7).
let placeholderTimer: number | null = null;
let placeholderIndex = 0;
let hasTyped = false; // first-keystroke latch — clearing the field never resumes rotation

function stopPlaceholderRotation(): void {
  if (placeholderTimer !== null) {
    window.clearInterval(placeholderTimer);
    placeholderTimer = null;
  }
  if (els) els.wishInput.placeholder = DEFAULT_WISH_PLACEHOLDER;
  placeholderIndex = 0;
}

function startPlaceholderRotation(): void {
  // Clear any existing timer FIRST (double-open must not stack timers) —
  // including the case where the early-returns below fire.
  stopPlaceholderRotation();
  // Never under reduced motion, never after the guest typed, never when the
  // retained text makes the input non-empty (closeFlow keeps typed text).
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || hasTyped || els?.wishInput.value) return;
  if (WISH_PLACEHOLDER_TEMPLATES.length === 0) return;
  // Spec (add-story-flow delta): a pass starts FROM THE DEFAULT — the
  // placeholder keeps the default until the first interval tick, then
  // advances one template per tick and settles back on the default.
  placeholderIndex = 0;
  placeholderTimer = window.setInterval(() => {
    if (!els || els.wishInput.value !== "") return; // non-empty: hold position
    if (placeholderIndex >= WISH_PLACEHOLDER_TEMPLATES.length) {
      // One pass, then settle — no perpetual auto-updating content.
      stopPlaceholderRotation();
      return;
    }
    els.wishInput.placeholder = WISH_PLACEHOLDER_TEMPLATES[placeholderIndex++];
  }, WISH_PLACEHOLDER_INTERVAL_MS);
}

function q<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`add-story-flow: missing ${selector}`);
  return el;
}

function showInline(el: HTMLElement, message: string | null): void {
  if (message === null) {
    el.classList.add("hidden");
    el.textContent = "";
  } else {
    el.classList.remove("hidden");
    el.textContent = message; // guest-facing strings are ours; textContent anyway
  }
}

function isDirty(): boolean {
  const wish = els?.wishInput.value.trim() ?? "";
  return wish.length > 0 || selectedFiles.length > 0;
}

function updateSubmitEnabled(): void {
  if (!els) return;
  const wishLen = els.wishInput.value.trim().length;
  const canSubmit = (wishLen > 0 || selectedFiles.length > 0) && !submitting;
  els.submitButton.disabled = !canSubmit;
}

function updateWishCount(): void {
  if (!els) return;
  const len = els.wishInput.value.length;
  els.wishCount.textContent = `${len} / ${WISH_MAX}`;
}

// Client-side pre-validation (server re-validates everything; this is fast
// feedback only). Returns an error message or null.
function validateFiles(files: File[]): string | null {
  if (files.length > MAX_PHOTOS) {
    return `Too many photos: ${files.length} of ${MAX_PHOTOS} max`;
  }
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) {
      return `"${file.name}" is over 10MB`;
    }
    if (!ACCEPTED_TYPES.has(file.type)) {
      return `"${file.name}" is not a JPEG, PNG, WebP, or AVIF`;
    }
  }
  return null;
}

function renderPhotoList(): void {
  const { photoList } = els ?? {};
  if (!photoList) return;
  photoList.replaceChildren();

  // Object URLs leak until revoked; each re-render rebuilds the list.
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];

  selectedFiles.forEach((file, index) => {
    const li = document.createElement("li");
    // The grid column supplies the width (3 across = full width); the 9:16
    // ratio comes from aspect-ratio so the crop matches the story tile.
    li.className = "relative aspect-[9/16] rounded-md overflow-hidden";

    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    img.src = url;
    img.alt = file.name;
    // object-cover previews the story tile's exact crop (9:16).
    img.className = "w-full h-full object-cover";
    img.decoding = "async";
    li.appendChild(img);

    // Always visible (no hover gate): touch devices have no hover, and a
    // photo that can't be canceled is a trap.
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className =
      "absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none flex items-center justify-center hover:bg-black/90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition cursor-pointer";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderPhotoList();
      updateSubmitEnabled();
      if (els) showInline(els.photoError, null);
    });
    li.appendChild(remove);

    photoList.appendChild(li);
  });

  syncPhotoClear();
}

// "Remove all" is only meaningful with something selected.
function syncPhotoClear(): void {
  const { photoClear } = els ?? {};
  if (!photoClear) return;
  photoClear.classList.toggle("invisible", selectedFiles.length === 0);
}

// Drop the selection entirely (Remove all / modal close / reset).
function clearSelectedPhotos(): void {
  selectedFiles = [];
  if (els) els.photoInput.value = ""; // let the same file be re-picked
  renderPhotoList();
  updateSubmitEnabled();
  if (els) showInline(els.photoError, null);
}

function openFlow(): void {
  if (!els) return;
  // Only pointer-events unlock immediately; the opacity-0 class stays and
  // animate() drives inline opacity so the entrance fades from the rest state.
  els.root.classList.remove("pointer-events-none");
  els.root.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  animate(els.root, { opacity: [0, 1] }, { duration: 0.15 });
  if (reducedMotion) {
    els.panel.style.transform = "none";
    animate(els.panel, { opacity: [0, 1] }, { duration: 0.15 });
  } else {
    animate(
      els.panel,
      { opacity: [0, 1], transform: ["translateY(16px) scale(0.95)", "translateY(0px) scale(1)"] },
      { duration: 0.2, ease: EASE_OUT_EXPO },
    );
  }

  startPlaceholderRotation();
  els.wishInput.focus();
}

function closeFlow(): void {
  if (!els) return;
  // Body unlock is synchronous — the page scrolls behind the fading exit.
  document.body.style.overflow = "";

  const { root, panel } = els;
  const restoreRestState = () => {
    root.classList.add("opacity-0", "pointer-events-none");
    root.setAttribute("aria-hidden", "true");
    root.style.removeProperty("opacity");
    root.style.removeProperty("transform");
    panel.style.removeProperty("opacity");
    panel.style.removeProperty("transform");
  };
  // Motion's WAAPI onfinish commits the final keyframe via setStyle in the
  // SAME tick the finished promise resolves, so the restore must run one
  // macrotask later or the final `opacity: 0` write lands after it.
  const restoreAfterSettle = () => {
    window.setTimeout(restoreRestState, 0);
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    panel.style.transform = "none";
    animate(panel, { opacity: [1, 0] }, { duration: 0.12 });
    animate(root, { opacity: [1, 0] }, { duration: 0.12 }).finished.then(restoreAfterSettle);
  } else {
    animate(
      panel,
      { opacity: [1, 0], transform: ["translateY(0px) scale(1)", "translateY(12px) scale(0.95)"] },
      { duration: 0.12, ease: EASE_OUT_EXPO },
    );
    animate(root, { opacity: [1, 0] }, { duration: 0.12 }).finished.then(restoreAfterSettle);
  }

  stopPlaceholderRotation();
  setSubmitting(false);
  // Closing discards the flow's transient state: a re-open starts fresh,
  // not with photos chosen in a previous abandoned attempt.
  clearSelectedPhotos();
}

function setSubmitting(on: boolean): void {
  if (!els) return;
  submitting = on;
  els.submitButton.disabled = on || !isDirty();
  els.spinner.classList.toggle("hidden", !on);
  els.submitLabel.textContent = on ? "Sharing…" : "Share";
}

// Server error codes → inline field errors (add-story-flow spec: 400 maps to
// the corresponding input; 409 maps to the already-posted state).
function applyServerError(code: string): void {
  if (!els) return;
  switch (code) {
    case "invalid_wish_text":
      showInline(els.wishError, "Wish text must be 1–30 characters after trimming.");
      break;
    case "too_many_photos":
      showInline(els.photoError, "Up to 3 photos.");
      break;
    case "photo_too_large":
      showInline(els.photoError, "Each photo must be 10MB or smaller.");
      break;
    case "invalid_photo_type":
      showInline(els.photoError, "Photos must be JPEG, PNG, WebP, or AVIF.");
      break;
    case "empty_submission":
      showInline(els.formError, "Add a wish or at least one photo.");
      break;
    case "already_posted":
      // Already-posted is a SUCCESS-equivalent state: the guest has a
      // submission. Close the flow, drop the cached payload (it said
      // mine=null — stale: the race was lost server-side), and resync.
      closeFlow();
      invalidateSubmissions();
      window.dispatchEvent(new CustomEvent(SUBMISSION_POSTED_EVENT));
      break;
    default:
      showInline(els.formError, "Something went wrong — try again.");
  }
}

async function submit(): Promise<void> {
  if (!els || submitting) return;
  const wishText = els.wishInput.value.trim();

  const wishLen = wishText.length;
  if (wishLen > WISH_MAX) {
    showInline(els.wishError, "Wish text must be 1–30 characters after trimming.");
    return;
  }
  if (wishLen === 0 && selectedFiles.length === 0) {
    showInline(els.formError, "Add a wish or at least one photo.");
    return;
  }

  setSubmitting(true);
  showInline(els.formError, null);

  const body = new FormData();
  if (wishLen > 0) body.append("wishText", wishText);
  for (const file of selectedFiles) {
    body.append("photos", file, file.name);
  }

  try {
    const res = await fetch("/api/submissions", {
      method: "POST",
      credentials: "same-origin",
      body,
    });

    if (res.status === 201) {
      invalidateSubmissions();
      closeFlow();
      window.dispatchEvent(new CustomEvent(SUBMISSION_POSTED_EVENT));
      return;
    }

    if (res.status === 409) {
      applyServerError("already_posted");
      return;
    }

    let code = "";
    try {
      const payload = (await res.json()) as { error?: unknown };
      if (typeof payload.error === "string") code = payload.error;
    } catch {
      code = "";
    }
    if (res.status === 400) {
      applyServerError(code || "invalid_body");
    } else {
      // 503 or anything else: flow stays open with a retry (spec: network
      // failure leaves the flow open).
      showInline(els.formError, "Couldn't reach the server — try again.");
    }
  } catch {
    showInline(els.formError, "Couldn't reach the server — try again.");
  } finally {
    setSubmitting(false);
  }
}

export function initAddStoryFlow(): void {
  if (els) return; // idempotent: index.astro's script may run once only anyway

  els = {
    root: q("#add-story-flow"),
    panel: q("[data-flow-panel]"),
    openButtons: [],
    cancelButton: q("[data-flow-cancel]"),
    form: q("[data-flow-form]"),
    wishInput: q<HTMLInputElement>("[data-wish-input]"),
    wishCount: q("[data-wish-count]"),
    wishError: q("[data-wish-error]"),
    photoInput: q<HTMLInputElement>("[data-photo-input]"),
    photoError: q("[data-photo-error]"),
    photoList: q("[data-photo-list]"),
    photoClear: q<HTMLButtonElement>("[data-photo-clear]"),
    formError: q("[data-flow-error]"),
    submitButton: q<HTMLButtonElement>("[data-flow-submit]"),
    submitLabel: q("[data-flow-submit-label]"),
    spinner: q("[data-flow-spinner]"),
  };

  els.root.addEventListener("click", (e) => {
    if (e.target === els?.root) closeFlow(); // backdrop click
  });
  els.cancelButton.addEventListener("click", closeFlow);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFlow();
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });

  els.wishInput.addEventListener("input", (e) => {
    // First user edit disables placeholder rotation for the whole page session
    // (story-rail-mocks D7): once someone is writing, suggestions stop
    // competing. Any trusted input event counts — insertion, deletion, paste,
    // IME composition (inputType covers them; `data === null` alone misses
    // deletion/replace paths). Clearing the field must not resume rotation.
    if (e.isTrusted) {
      hasTyped = true;
      stopPlaceholderRotation();
    }
    updateWishCount();
    updateSubmitEnabled();
    showInline(els!.wishError, null);
  });

  els.photoInput.addEventListener("change", () => {
    if (!els) return;
    const incoming = Array.from(els.photoInput.files ?? []);
    const candidate = [...selectedFiles, ...incoming];
    const error = validateFiles(candidate);
    if (error) {
      showInline(els.photoError, error);
      els.photoInput.value = "";
      return;
    }
    selectedFiles = candidate;
    els.photoInput.value = "";
    showInline(els.photoError, null);
    renderPhotoList();
    updateSubmitEnabled();
  });

  // "Remove all" next to the Photos label.
  els.photoClear.addEventListener("click", clearSelectedPhotos);

  updateWishCount();
}

// Open from anywhere (the rail tile calls this).
export function openAddStoryFlow(): void {
  openFlow();
}
