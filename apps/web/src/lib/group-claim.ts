import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  generateInviteId,
  INVITE_ID_MAX_ATTEMPTS,
  isInviteIdCollision,
  redactInviteError,
} from "./invite-id";

export interface ClaimTargetGroup {
  id: string;
}

interface ClaimRow {
  id: string;
  display_name: string;
}

export type ClaimResult =
  /** A member row was inserted; the slot is consumed. */
  | { status: "claimed"; id: string; displayName: string }
  /** The conditional statement executed and inserted zero rows. */
  | { status: "no_slot" }
  /** Operational failure (storage error, or id collisions exhausted). */
  | { status: "unavailable" };

/**
 * Mints one member invite under `group`, conditioned on the quota.
 *
 * THIS SINGLE STATEMENT IS THE ONLY QUOTA GUARD. SQLite serializes writes, so a
 * conditional `INSERT … SELECT … WHERE count < max_members` cannot race: the
 * N+1th concurrent claimant observes the committed count and inserts zero rows.
 * There is no count-based CHECK in SQLite to fall back on, which means:
 *
 *   1. It must NEVER degrade into read-then-write across statements outside a
 *      transaction — a `SELECT COUNT` followed by an `INSERT` would interleave
 *      on the event loop and over-allocate even on this single shared client.
 *   2. No other code path may insert rows with `parent_id` set (the admin
 *      endpoint rejects `parentId`).
 *
 * Both subqueries bind the SAME `group.id` (6 bind parameters total) so a refactor
 * cannot accidentally split the count from the quota it is compared against.
 * `displayName` is always bound, never interpolated.
 */
export async function claimMemberSlot(
  group: ClaimTargetGroup,
  displayName: string,
  now: number,
): Promise<ClaimResult> {
  for (let attempt = 0; attempt < INVITE_ID_MAX_ATTEMPTS; attempt++) {
    const id = generateInviteId();

    try {
      const rows = await db.all<ClaimRow>(sql`
        INSERT INTO invites (id, display_name, created_at, parent_id, type)
        SELECT ${id}, ${displayName}, ${now}, ${group.id}, 'individual'
        WHERE (SELECT COUNT(*) FROM invites AS siblings WHERE siblings.parent_id = ${group.id})
            < (SELECT max_members FROM invites AS grp WHERE grp.id = ${group.id})
        RETURNING id, display_name
      `);

      const row = rows[0];
      // Zero rows is a successfully executed statement that inserted nothing:
      // quota full, or the group vanished. The caller distinguishes the two.
      if (!row) return { status: "no_slot" };
      // The driver builds rows by copying enumerable keys. If that ever yielded
      // an empty (but TRUTHY) object we would hand back an undefined id, set a
      // cookie that fails INVITE_ID_RE, and burn a slot while reporting 201 —
      // leaving the guest anonymous with a success message. Fail loud instead.
      if (
        typeof row.id !== "string" ||
        row.id.length === 0 ||
        typeof row.display_name !== "string"
      ) {
        console.error("[group-claim] claim statement returned an unusable row");
        return { status: "unavailable" };
      }
      return { status: "claimed", id: row.id, displayName: row.display_name };
    } catch (error) {
      // Only a genuine `invites.id` collision may be retried, and each retry
      // re-executes the WHOLE conditional statement with a fresh id — never a
      // bare INSERT, which would bypass the guard above.
      //
      // This branch deliberately does NOT run the reconciliation read below. A
      // collision means a DIFFERENT row already holds this id, so our own insert
      // provably did not commit and there is nothing to find. Even a false
      // positive would be harmless: that read is keyed on the exact id we just
      // generated — the one that collided — so it would return null and fall
      // through to the retry anyway.
      if (isInviteIdCollision(error)) {
        console.error(
          `[group-claim] invite id collision (attempt ${attempt + 1}):`,
          redactInviteError(error),
        );
        continue;
      }

      // The statement may have COMMITTED before the failure surfaced — a remote
      // libSQL response can be lost after the server commits, exactly the hazard
      // `guest-photo-upload.ts` reconciles with findAttempt(). Establish THIS
      // attempt's outcome against its own generated id before giving up. Without
      // this the caller gets a retryable 503 carrying no Set-Cookie, the browser
      // keeps the GROUP identity, and the guest's retry mints a SECOND member row
      // — two slots for one person out of a quota that may be as small as 2.
      const committed = await findCommittedClaim(id, group.id);
      if (committed) return committed;

      console.error("[group-claim] member insert failed:", redactInviteError(error));
      return { status: "unavailable" };
    }
  }

  return { status: "unavailable" };
}

/**
 * Follow-up the caller MUST run when `claimMemberSlot` returned `no_slot`: a
 * vanished group is an operator-visible, retryable `503`, while a present group
 * is a genuine `409 group_full`. `null` means the re-check itself failed, which
 * must also map to `503` — an unknown state is never reported as "full".
 */
export async function inviteExists(id: string): Promise<boolean | null> {
  try {
    const rows = await db
      .select({ id: invites.id })
      .from(invites)
      .where(eq(invites.id, id))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    console.error("[group-claim] group re-check failed:", redactInviteError(error));
    return null;
  }
}

// Reconciliation read for a claim whose outcome is unknown. Scoped to the exact
// generated id AND this group, so it can never resolve to another guest's row.
// Any ambiguity — no match, or a failed read — yields null and the caller reports
// a retryable 503. An unknown outcome is never reported as success, and never as
// `group_full`.
async function findCommittedClaim(id: string, groupId: string): Promise<ClaimResult | null> {
  try {
    const rows = await db
      .select({ id: invites.id, displayName: invites.displayName })
      .from(invites)
      .where(and(eq(invites.id, id), eq(invites.parentId, groupId)))
      .limit(1);
    const row = rows[0];
    // Same shape guard as the happy path: without it a malformed row would 201
    // with `displayName: undefined` straight into the response body.
    if (
      !row ||
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      typeof row.displayName !== "string"
    ) {
      return null;
    }
    return { status: "claimed", id: row.id, displayName: row.displayName };
  } catch (error) {
    console.error(
      "[group-claim] post-failure reconciliation read failed:",
      redactInviteError(error),
    );
    return null;
  }
}
