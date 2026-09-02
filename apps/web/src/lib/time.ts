// Relative-time formatting shared by every story surface.
//
// story-rail-attribution D5: StoryViewer used to own this formatter inside its
// bundled <script>, so the client-built guest tiles (scripts/guest-rail.ts)
// had no way to format a submission's `createdAt` the way an SSR tile formats
// its `timestamp` prop. One implementation, two consumers — the modal author
// header and the rail script.

/**
 * Format a point in time as a coarse relative string: `Just now` (≤1 minute),
 * `Xm ago`, `Xh ago`, `Xd ago`.
 *
 * Accepts anything `new Date()` can parse — an ISO string (StoryViewer's
 * `timestamp` prop) or epoch milliseconds (the wall payload's `createdAt`).
 * A missing value formats to `""` so callers can render nothing rather than a
 * placeholder. An unparseable STRING is echoed back verbatim (a hand-written
 * label such as "Yesterday" survives); an unparseable number formats to `""`.
 */
export function formatRelativeTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    return diffMinutes <= 1 ? "Just now" : `${diffMinutes}m ago`;
  }
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}
