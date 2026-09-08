// Add-story flow client logic (guest-submissions 4.1/D5).
//
// Wired by index.astro. The modal lives in AddStoryFlow.astro; this module
// owns open/close, client-side pre-validation, submit, and the post-submit
// state transition (tile removal + surfaces re-sync via submissions:posted).
//
// Photo-only (retire-wishes-story-intro D1/D2): wishes are retired, so the
// flow is a single photo picker and at least one photo is required.

import { animate } from "motion";

import { invalidateSubmissions, SUBMISSION_POSTED_EVENT } from "../lib/submissions-client";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// JS twin of the CSS --ease-out-expo token; keep in sync.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

interface FlowElements {
  root: HTMLElement;
  panel: HTMLElement;
  openButtons: HTMLElement[];
  cancelButton: HTMLButtonElement;
  form: HTMLFormElement;
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
  return selectedFiles.length > 0;
}

function updateSubmitEnabled(): void {
  if (!els) return;
  els.submitButton.disabled = !isDirty() || submitting;
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

  // Photo-only flow (retire-wishes-story-intro): move focus into the dialog
  // on open. Focusing the dialog root (role="dialog", aria-modal, labelled
  // "Share our stories") announces the modal to assistive tech and puts the
  // starting point inside the trap; the user tabs to "Choose photos" next.
  els.root.focus();
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
      showInline(els.formError, "Add at least one photo.");
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

  if (selectedFiles.length === 0) {
    showInline(els.formError, "Add at least one photo.");
    return;
  }

  setSubmitting(true);
  showInline(els.formError, null);

  const body = new FormData();
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
}

// Open from anywhere (the rail tile calls this).
export function openAddStoryFlow(): void {
  openFlow();
}
