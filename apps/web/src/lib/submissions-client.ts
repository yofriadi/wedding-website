// Shared client-side access to GET /api/submissions.
//
// The story rail reads this payload; importing this module from multiple
// bundled component scripts shares ONE module instance (Vite chunk dedupe),
// so the page makes exactly one fetch per load.
//
// public-wall D2: the wall is a public surface — loadSubmissions() fetches
// for EVERYONE (the old zero-request guarantee for cookie-less visitors is
// retired). Anonymous callers get `{ mine: null, wall }`; posting surfaces
// gate on the server-resolved `inviteValid`, never on cookie shape.

export interface SubmissionPhoto {
  photoUrl: string;
  thumbnailUrl: string;
}

// story-rail-attribution D7: additive contract fields. Every STORY entry
// (wall and the caller's own) carries the poster's first name and the
// submission time so the rail can attribute its tiles. `firstName` is null
// when the invite's display_name derives an empty first token — the tile then
// renders the attribution-free layout.
export interface SubmissionStory {
  photos: SubmissionPhoto[];
  firstName: string | null;
  createdAt: number;
}

export interface SubmissionsPayload {
  mine: {
    id: string;
    photos: SubmissionPhoto[];
    firstName: string | null;
    createdAt: number;
  } | null;
  // Server-side invite resolution (public-wall fix): true only when the
  // cookie resolved to a real invite. A STALE well-shaped cookie is false —
  // the add-story tile must not stay visible for an unpostable identity.
  // Optional so older payloads (and test fixtures) without it still parse.
  inviteValid?: boolean;
  wall: {
    stories: SubmissionStory[];
  };
}

let inflight: Promise<SubmissionsPayload | null> | null = null;

// Fetch once per page load. Returns null on any failure — callers treat null
// as "stay in the current state". Anonymous callers fetch too (public-wall
// D2): the API answers them 200 with `{ mine: null, wall }`; only an unknown
// cookie still 404s (terminal).
//
// Caching: only SUCCESSFUL answers (and the terminal 404 "unknown cookie"
// answer) stay cached — a transient failure (5xx, offline, parse error)
// clears the cache so the next loadSubmissions() retries instead of being
// stuck on a cached null for the rest of the page session.
export function loadSubmissions(): Promise<SubmissionsPayload | null> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/submissions", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) return null; // unknown cookie → public state (terminal)
      if (!res.ok) {
        inflight = null; // transient failure: allow a retry on the next call
        return null;
      }
      return (await res.json()) as SubmissionsPayload;
    } catch {
      inflight = null; // transient failure: allow a retry on the next call
      return null;
    }
  })();
  return inflight;
}

// Invalidate after a successful POST so the next loadSubmissions() refetches
// (the marquee and rail swap to the fresh real state).
export function invalidateSubmissions(): void {
  inflight = null;
}

// Dispatched after a successful POST /api/submissions so every surface that
// renders submissions state (rail, add-story tile) re-syncs without a full
// page reload (the loader + welcome gate make reloads expensive UX).
export const SUBMISSION_POSTED_EVENT = "submissions:posted";
