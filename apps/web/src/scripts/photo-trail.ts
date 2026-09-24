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
  // Group identities are valid but UNCLAIMED: slots open ⇒ the pill stays
  // hidden until claimed at entry; quota exhausted ⇒ read-only capacity state.
  claim_required: "Klaim tempatmu dulu untuk menambahkan gambar.",
  group_full: "Undangan grup ini sudah penuh.",
};
const SYNC_ERROR =
  "Gambar sudah diunggah, tetapi galeri belum diperbarui. Coba lagi untuk memuatnya.";
const GROUP_FULL_LABEL = "Grup sudah penuh";

/**
 * "none"    — standalone individual or claimed member: the normal uploader rules.
 * "claim"   — group cookie with slots open: the pill stays hidden until claimed at entry.
 * "full"    — group cookie at quota: show the read-only capacity state.
 * "unknown" — the identity probe could not answer. Treated as INELIGIBLE (the
 *             guest-photo-trail spec bars "unresolved/error states" from opening
 *             a chooser) but not as a group, so the pill stays hidden instead of
 *             advertising a control that cannot work. Retried on the next
 *             refresh rather than pinned for the whole page lifetime.
 */
type GroupIdentityState = "none" | "claim" | "full" | "unknown";

// Identity kind comes from the cookie-gated /api/invite/me, never from cookie
// shape.
//
// The presence check below is NOT authorization — it only avoids a
// guaranteed-404 identity probe on every anonymous homepage load, since this
// control renders unconditionally. Eligibility still comes solely from the
// server responses. The cookie is httpOnly:false by design so it is readable
// here; if that ever changed the probe would simply be skipped and the server's
// 409 claim_required path would remain the backstop. Mirrors
// INVITE_COOKIE_NAME/INVITE_ID_RE in lib/invite-session.ts.
const INVITE_COOKIE_PRESENT = /(?:^|;\s*)ww_invite_id=[A-Za-z0-9_-]{12}(?:\s|;|$)/;

async function loadGroupIdentityState(): Promise<GroupIdentityState> {
  if (!INVITE_COOKIE_PRESENT.test(document.cookie)) return "none";
  try {
    const response = await fetch("/api/invite/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    // A 404 is a DEFINITIVE answer — no valid identity, so not a group. Any
    // other non-200 (503, an aborted request) means "we could not find out",
    // which must not be confused with "not a group".
    if (response.status === 404) return "none";
    if (!response.ok) return "unknown";
    const payload = (await response.json()) as {
      kind?: unknown;
      group?: { maxMembers?: unknown; claimedCount?: unknown };
    };
    if (payload.kind !== "group") return "none";
    const max = Number(payload.group?.maxMembers);
    if (!Number.isFinite(max)) return "claim";
    const claimed = Number(payload.group?.claimedCount ?? 0);
    return (Number.isFinite(claimed) ? claimed : 0) >= max ? "full" : "claim";
  } catch {
    return "unknown";
  }
}

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
  // Identity kind changes through entry claiming, which is an in-place
  // handoff — so a DEFINITIVE answer is authoritative only until claim:success
  // or claim:capacity invalidates it below. A failed probe is deliberately NOT
  // cached: one transient blip would otherwise hide the uploader until a reload.
  let groupState: GroupIdentityState = "none";
  // Started EAGERLY, not lazily inside syncGroupState: refresh() awaits that
  // AFTER `await loadGuestPhotos()`, so a lazily-created probe would make the
  // pill's first paint wait on two SERIAL round trips. Kicking it off here lets
  // it run in parallel with the first collection read — on a slow connection
  // that is the difference between one latency budget and two.
  let groupProbe: Promise<GroupIdentityState> | null = loadGroupIdentityState();
  let groupRetryTimer = 0;
  const syncGroupState = async () => {
    if (groupProbe === null) groupProbe = loadGroupIdentityState();
    const probe = groupProbe;
    const next = await probe;
    // Identity-guard the reset: two refreshes can overlap and both await the
    // shared promise, so a stale continuation must not drop a NEWER in-flight
    // probe that a third caller has already installed.
    const isCurrent = groupProbe === probe;
    if (next === "unknown" && isCurrent) groupProbe = null;
    if (isCurrent) groupState = next;
    // Recovery must not depend on the guest happening to switch tabs — focus and
    // visibilitychange are the only other triggers, so a single-page visit would
    // never retry. "unknown" fails closed for the pill, which is right for a
    // group identity, but it also hides the uploader from an eligible INDIVIDUAL
    // whose only problem was a blip on this secondary endpoint while
    // /api/guest-photos answered fine. Schedule one delayed retry.
    if (next === "unknown" && groupRetryTimer === 0 && !disposed) {
      groupRetryTimer = window.setTimeout(() => {
        groupRetryTimer = 0;
        if (!disposed) void reloadPhotos();
      }, 3000);
    }
  };
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
    // An at-capacity group identity reveals the pill as the capacity affordance;
    // an unclaimed group identity hides it until claimed at entry.
    const groupAffordance = groupState === "full";
    button.hidden =
      !inviteValid ||
      groupState === "claim" ||
      (!canPost && !committed && !uncertain && !groupAffordance);
    button.dataset.state = state;
    button.setAttribute("aria-busy", String(state === "uploading"));
    // Keep keyboard focus on the status button, but guard every activation.
    button.setAttribute("aria-disabled", String(state !== "idle"));
    input.disabled = !canPost || state !== "idle";
    if (state === "uploading") label.textContent = "Mengunggah…";
    else if (state === "success") label.textContent = "Foto ditambahkan";
    else if (groupState === "full") label.textContent = GROUP_FULL_LABEL;
    else if (selectedFile || committed || uncertain) label.textContent = "Coba lagi";
    else label.textContent = "Tambah punyamu";
    indicator?.setUploading(state === "uploading");
    reveal();
  };

  const refresh = async () => {
    const version = ++requestVersion;
    const data = await loadGuestPhotos();
    if (disposed || version !== requestVersion) return null;
    await syncGroupState();
    if (disposed || version !== requestVersion) return null;

    // Fail closed. A cookie's shape alone is never permission to post. A
    // transient read failure after a committed upload must not hide its status.
    if (data || (!committed && !uncertain)) inviteValid = data?.inviteValid === true;
    if (data?.inviteValid && data.mineId !== null) {
      committed = true;
      uncertain = false;
      selectedFile = null;
    }
    canPost =
      data?.inviteValid === true &&
      data.mineId === null &&
      !committed &&
      !uncertain &&
      // An unclaimed group identity is never eligible for a chooser.
      groupState === "none";
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
        if (response.status === 201) {
          committed = true;
          canPost = false;
          selectedFile = null;
          invalidateGuestPhotos();
          window.dispatchEvent(new CustomEvent(GUEST_PHOTO_POSTED_EVENT));
        } else {
          // CLASSIFY BY ERROR CODE, NEVER BY STATUS ALONE. `already_posted` is
          // the ONLY 409 that means committed; an unreadable or unrecognized
          // body — including any other 409 — is an uncertain outcome and must
          // never set `committed`.
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          const code = typeof payload?.error === "string" ? payload.error : "";
          if (response.status === 409 && code === "already_posted") {
            committed = true;
            canPost = false;
            selectedFile = null;
            invalidateGuestPhotos();
            window.dispatchEvent(new CustomEvent(GUEST_PHOTO_POSTED_EVENT));
          } else if (response.status === 409 && code === "claim_required") {
            // A stale render where this browser holds an unclaimed group identity.
            // Keep the pill hidden — claiming happens at the entry gate.
            groupState = "claim";
            // Invalidate the cached probe: the server just told us something the
            // earlier answer did not know, and the next refresh must not silently
            // revert the pill by awaiting a stale definitive value.
            groupProbe = null;
            canPost = false;
            selectedFile = null;
            invalidateGuestPhotos();
            state = "idle";
            status.textContent = "";
            showError();
            return;
          } else if (response.status === 409 && code === "group_full") {
            groupState = "full";
            groupProbe = null; // as above — the quota moved under this render
            canPost = false;
            selectedFile = null;
            invalidateGuestPhotos();
            throw new Error(PHOTO_ERRORS.group_full);
          } else if (response.status === 404) {
            inviteValid = false;
            canPost = false;
            selectedFile = null;
            invalidateGuestPhotos();
            throw new Error("Buka kembali tautan undanganmu untuk menambahkan gambar.");
          } else if (response.status === 400) {
            selectedFile = null; // Invalid input needs a new selection, not a retry.
            throw new Error(PHOTO_ERRORS[code] ?? "Pilih gambar lain dan coba lagi.");
          } else {
            uncertain = true; // A 503 may conceal a commit whose reconciliation failed.
            canPost = false;
            invalidateGuestPhotos();
            throw new Error("Gambar belum berhasil diunggah. Coba lagi.");
          }
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

  // Named apart from `window.location.reload()` on purpose: this module calls
  // both, and a bare `reload()` next to a full-page reload is a refactor hazard.
  const reloadPhotos = async () => {
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
    if (disposed || state !== "idle") return;
    // Group identities never reach the file chooser. Slots open ⇒ the pill
    // stays hidden; quota exhausted ⇒ the read-only capacity state.
    if (groupState === "claim") return;
    if (groupState === "full") {
      showError(PHOTO_ERRORS.group_full);
      return;
    }
    if (!inviteValid) return;
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
    if (document.visibilityState === "visible") void reloadPhotos();
  };
  const posted = () => {
    void reloadPhotos();
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
  const onClaimSuccess = () => {
    groupProbe = null;
    invalidateGuestPhotos();
    void reloadPhotos();
  };
  const onClaimCapacity = () => {
    groupProbe = null;
    groupState = "full";
    render();
  };
  window.addEventListener("claim:success", onClaimSuccess);
  window.addEventListener("claim:capacity", onClaimCapacity);
  void reloadPhotos();

  return () => {
    disposed = true;
    ++requestVersion;
    cancelAnimationFrame(revealFrame);
    window.clearTimeout(groupRetryTimer);
    observer.disconnect();
    indicator?.destroy();
    button.removeEventListener("click", open);
    input.removeEventListener("change", pick);
    input.removeEventListener("cancel", cancel);
    window.removeEventListener("claim:success", onClaimSuccess);
    window.removeEventListener("claim:capacity", onClaimCapacity);
    window.removeEventListener("scroll", reveal);
    window.removeEventListener("resize", reveal);
    window.removeEventListener(GUEST_PHOTO_POSTED_EVENT, posted);
    window.removeEventListener("focus", retry);
    document.removeEventListener("visibilitychange", retry);
  };
}
