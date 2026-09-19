import { selectTrailImages } from "../lib/photo-trail";
import {
  invalidateGuestPhotos,
  loadGuestPhotos,
  GUEST_PHOTO_POSTED_EVENT,
} from "../lib/guest-photos-client";
import { initPhotoUploadIndicator } from "./photo-upload-indicator";

type TrailElement = HTMLElement & {
  setImages(images: string[], priority?: string[]): Promise<string[]>;
};
type UploadState = "idle" | "uploading" | "success";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const PHOTO_ERRORS: Record<string, string> = {
  too_many_photos: "Pilih satu gambar saja.",
  photo_too_large: "Ukuran gambar maksimal 10 MB.",
  invalid_photo_type: "Pilih gambar JPEG, PNG, WebP, atau AVIF yang valid.",
  empty_photo: "Pilih satu gambar terlebih dahulu.",
};
const SYNC_ERROR =
  "Gambar sudah diunggah, tetapi galeri belum diperbarui. Coba lagi untuk memuatnya.";

/** Public photos and an invite-only uploader; feedback stays inside the sticky CTA. */
export function initPhotoTrail(controls: HTMLElement): () => void {
  const section = controls.closest<HTMLElement>("[data-photo-trail-section]");
  const trail = section?.querySelector<TrailElement>("[data-trail]");
  const button = controls.querySelector<HTMLButtonElement>("[data-add-image]");
  const input = controls.querySelector<HTMLInputElement>("[data-photo-input]");
  const label = controls.querySelector<HTMLElement>("[data-photo-label]");
  const error = controls.querySelector<HTMLElement>("[data-photo-error]");
  const status = controls.querySelector<HTMLElement>("[data-photo-status]");
  if (!section || !trail || !button || !input || !label || !error || !status) return () => {};
  const icon = button.querySelector<HTMLElement>(".photo-cta__icon");
  const indicator = icon ? initPhotoUploadIndicator(icon) : null;

  let disposed = false;
  let inviteValid = false;
  let canPost = false;
  let state: UploadState = "idle";
  let selectedFile: File | null = null;
  // Once the server commits, retry only the gallery refresh, never the upload.
  let committed = false;
  let uncertain = false;
  let revealFrame = 0;
  let requestVersion = 0;

  const reveal = () => {
    if (disposed || revealFrame) return;
    // Let a just-unhidden button paint its compact starting style. Scroll
    // events only change the target state; CSS handles motion and reversals.
    revealFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0;
        if (disposed) return;
        // Going back above the button's natural location reverses its entrance.
        // Going past it keeps the pill expanded and parked inside the section.
        // Do not use `hidden` here: sticky positioning must survive the exit.
        controls.toggleAttribute(
          "data-revealed",
          !button.hidden && controls.getBoundingClientRect().top < window.innerHeight,
        );
      });
    });
  };

  const showError = (message = "") => {
    error.textContent = message;
    error.hidden = !message;
  };

  const render = () => {
    button.hidden = !inviteValid || (!canPost && !committed && !uncertain);
    button.dataset.state = state;
    button.setAttribute("aria-busy", String(state === "uploading"));
    // Keep keyboard focus on the status button, but guard every activation.
    button.setAttribute("aria-disabled", String(state !== "idle"));
    input.disabled = !canPost || state !== "idle";
    if (state === "uploading") label.textContent = "Mengunggah…";
    else if (state === "success") label.textContent = "Foto ditambahkan";
    else if (selectedFile || committed || uncertain) label.textContent = "Coba lagi";
    else label.textContent = "Tambah punyamu";
    indicator?.setUploading(state === "uploading");
    reveal();
  };

  const refresh = async () => {
    const version = ++requestVersion;
    const data = await loadGuestPhotos();
    if (disposed || version !== requestVersion) return null;

    // Fail closed. A cookie's shape alone is never permission to post. A
    // transient read failure after a committed upload must not hide its status.
    if (data || (!committed && !uncertain)) inviteValid = data?.inviteValid === true;
    if (data?.inviteValid && data.mineId !== null) {
      committed = true;
      uncertain = false;
      selectedFile = null;
    }
    canPost = data?.inviteValid === true && data.mineId === null && !committed && !uncertain;
    controls.dataset.ready = "true";
    render();
    if (!data) return null; // Keep the last shown photos on network/DB failures.

    await customElements.whenDefined("magnetic-image-trail");
    if (disposed || version !== requestVersion) return null;
    const loaded = await trail.setImages(
      selectTrailImages(data),
      data.photos.filter((photo) => photo.id === data.mineId).map((photo) => photo.photoUrl),
    );
    if (disposed || version !== requestVersion) return null;
    return { data, loaded };
  };

  const submit = async () => {
    if (disposed || state !== "idle" || !inviteValid) return;
    if (!committed && !uncertain && (!canPost || !selectedFile)) return;
    ++requestVersion; // Ignore a pre-picker refresh that is still decoding.
    state = "uploading";
    showError();
    status.textContent = "Mengunggah gambar…";
    render();

    try {
      if (uncertain) {
        invalidateGuestPhotos();
        const reconciliation = await refresh();
        if (disposed) return;
        if (!reconciliation) throw new Error("Belum dapat memeriksa unggahan. Coba lagi.");
        uncertain = false;
        if (!inviteValid) {
          selectedFile = null;
          throw new Error("Buka kembali tautan undanganmu untuk menambahkan gambar.");
        }
        canPost = !committed;
      }
      if (!committed) {
        const body = new FormData();
        const file = selectedFile!;
        body.append("photo", file, file.name);
        let response: Response;
        try {
          response = await fetch("/api/guest-photos", {
            method: "POST",
            credentials: "same-origin",
            body,
          });
        } catch (error) {
          invalidateGuestPhotos();
          if (disposed) return;
          uncertain = true;
          canPost = false;
          throw error;
        }
        if (disposed) {
          invalidateGuestPhotos();
          return;
        }
        if (response.status === 201 || response.status === 409) {
          committed = true;
          canPost = false;
          selectedFile = null;
          invalidateGuestPhotos();
          window.dispatchEvent(new CustomEvent(GUEST_PHOTO_POSTED_EVENT));
        } else if (response.status === 404) {
          inviteValid = false;
          canPost = false;
          selectedFile = null;
          invalidateGuestPhotos();
          throw new Error("Buka kembali tautan undanganmu untuk menambahkan gambar.");
        } else {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          if (response.status === 400) {
            selectedFile = null; // Invalid input needs a new selection, not a retry.
            throw new Error(
              PHOTO_ERRORS[payload.error ?? ""] ?? "Pilih gambar lain dan coba lagi.",
            );
          }
          uncertain = true; // A 503 may conceal a commit whose reconciliation failed.
          canPost = false;
          invalidateGuestPhotos();
          throw new Error("Gambar belum berhasil diunggah. Coba lagi.");
        }
      } else {
        invalidateGuestPhotos();
      }
      if (disposed) return;

      const result = await refresh();
      if (disposed) return;
      if (
        !result?.data.photos.some(
          (photo) => photo.id === result.data.mineId && result.loaded.includes(photo.photoUrl),
        )
      ) {
        throw new Error(SYNC_ERROR);
      }
      state = "success";
      status.textContent = "Foto ditambahkan";
    } catch (cause) {
      if (disposed) return;
      state = "idle";
      status.textContent = "";
      let message: string;
      if (committed) message = SYNC_ERROR;
      else if (cause instanceof Error && cause.message !== "Failed to fetch")
        message = cause.message;
      else message = "Tidak dapat terhubung ke server. Coba lagi.";
      showError(message);
    } finally {
      if (!disposed) render();
    }
  };

  const reload = async () => {
    if (disposed || state === "uploading") return;
    if (uncertain || (committed && state !== "success")) {
      void submit();
      return;
    }
    const result = await refresh();
    // refresh() discards responses superseded by a newly started upload.
    if (disposed || !result) return;
    if (result.data.inviteValid && result.data.mineId !== null) {
      committed = true;
      selectedFile = null;
      const decoded = result.data.photos.some(
        (photo) => photo.id === result.data.mineId && result.loaded.includes(photo.photoUrl),
      );
      state = decoded ? "success" : "idle";
      showError(decoded ? "" : SYNC_ERROR);
      render();
    }
  };

  const open = () => {
    if (disposed || !inviteValid || state !== "idle") return;
    if (committed || uncertain || selectedFile) {
      void submit();
    } else if (canPost) {
      showError();
      // Remain in the original user activation, including Safari/keyboard taps.
      input.click();
    }
  };
  const pick = () => {
    const files = Array.from(input.files ?? []);
    input.value = ""; // The same file can be picked again after validation fails.
    if (!canPost || state !== "idle" || files.length === 0) return;
    const file = files[0]!;
    let message = "";
    if (files.length !== 1) message = PHOTO_ERRORS.too_many_photos;
    else if (file.size > MAX_PHOTO_BYTES) message = PHOTO_ERRORS.photo_too_large;
    else if (!ACCEPTED_TYPES.has(file.type)) message = PHOTO_ERRORS.invalid_photo_type;
    if (message) {
      showError(message);
      button.focus({ preventScroll: true });
      return;
    }
    selectedFile = file;
    button.focus({ preventScroll: true });
    void submit();
  };
  const cancel = () => button.focus({ preventScroll: true });
  const retry = () => {
    if (document.visibilityState === "visible") void reload();
  };
  const posted = () => {
    void reload();
  };

  const observer = new IntersectionObserver(reveal);
  observer.observe(controls);
  button.addEventListener("click", open);
  input.addEventListener("change", pick);
  input.addEventListener("cancel", cancel);
  window.addEventListener("scroll", reveal, { passive: true });
  window.addEventListener("resize", reveal);
  window.addEventListener(GUEST_PHOTO_POSTED_EVENT, posted);
  window.addEventListener("focus", retry);
  document.addEventListener("visibilitychange", retry);
  void reload();

  return () => {
    disposed = true;
    ++requestVersion;
    cancelAnimationFrame(revealFrame);
    observer.disconnect();
    indicator?.destroy();
    button.removeEventListener("click", open);
    input.removeEventListener("change", pick);
    input.removeEventListener("cancel", cancel);
    window.removeEventListener("scroll", reveal);
    window.removeEventListener("resize", reveal);
    window.removeEventListener(GUEST_PHOTO_POSTED_EVENT, posted);
    window.removeEventListener("focus", retry);
    document.removeEventListener("visibilitychange", retry);
  };
}
