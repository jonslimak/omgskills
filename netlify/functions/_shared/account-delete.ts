import type { Pool } from "pg";
import { deleteCloudSkills } from "./cloud-save.js";
import type { CloudObjectStore } from "./cloud-store.js";

export class AccountDeleteError extends Error {
  constructor(readonly code: "storage_unavailable" | "sign_in_delete_failed", message: string) {
    super(message);
  }
}

export type AccountDeleteDependencies = {
  /** Object storage for saved skill files; null when cloud save isn't set up here. */
  store(): CloudObjectStore | null;
  /** Deletes the sign-in account, which also signs it out everywhere and ends agents' access. */
  deleteSignIn(clerkUserId: string): Promise<void>;
};

// What an emptied account record keeps: its id, so the records others own can still point at it.
const emptyRecord = `
  UPDATE users
  SET clerk_user_id = 'deleted:' || id::text,
      email = 'deleted+' || id::text || '@deleted.invalid',
      display_name = NULL,
      handle = NULL,
      handle_updated_at = NULL,
      profile_published = false,
      updated_at = now()
`;

/**
 * Deletes a person's account: saved skills and their files, Sets (with their invite lists and
 * public pages), Favorites, Macs, agents, sync history and My skills additions. Items in other
 * people's Sets that come from this person's private GitHub skills or saved skills lose that
 * content and keep only their name. Private GitHub sources are retired, since their versions can
 * never be deleted, and the account record is emptied rather than deleted because those versions
 * still point at it. The sign-in account goes last; if that fails, everything else is already
 * gone and trying again finishes it.
 */
export async function deleteAccount(
  pool: Pool,
  dependencies: AccountDeleteDependencies,
  input: { userId: string; clerkUserId: string }
): Promise<{ deletedSets: number }> {
  const { userId } = input;
  const cloud = await pool.query<{ count: number }>(
    `
      SELECT (
        (SELECT count(*) FROM skill_sources WHERE kind = 'cloud' AND owner_user_id = $1)
        + (SELECT count(*) FROM cloud_blobs WHERE user_id = $1)
      )::int AS count
    `,
    [userId]
  );
  if (cloud.rows[0].count > 0) {
    const store = dependencies.store();
    if (!store) throw new AccountDeleteError("storage_unavailable", "Saved skills can't be deleted right now");
    // Also detaches this person's saved skills from other people's Sets.
    await deleteCloudSkills(pool, store, { userId });
  }

  const client = await pool.connect();
  let deletedSets: number;
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
    // Takes the upload lock, so no Mac saves a skill while the account goes.
    await client.query("SELECT 1 FROM cloud_save_settings WHERE user_id = $1 FOR UPDATE", [userId]);

    const privateSources = await client.query<{ id: string }>(
      "SELECT id FROM skill_sources WHERE owner_user_id = $1 AND kind = 'private_github'",
      [userId]
    );
    const sourceIds = privateSources.rows.map((row) => row.id);
    // Other people's Sets keep the item's name; a private repo's link and content go with the account.
    // Lock those Sets before their items, the same order Set edits use.
    await client.query(
      `
        SELECT id FROM skill_groups
        WHERE owner_user_id <> $2
          AND id IN (SELECT group_id FROM skill_group_items WHERE source_id = ANY($1::uuid[]))
        ORDER BY id
        FOR UPDATE
      `,
      [sourceIds, userId]
    );
    await client.query(
      `
        WITH detached AS (
          UPDATE skill_group_items item
          SET source_id = NULL, release_id = NULL, github_url = NULL,
              metadata_only_reason = 'source_unavailable'
          FROM skill_groups set_row
          WHERE item.group_id = set_row.id
            AND set_row.owner_user_id <> $2
            AND item.source_id = ANY($1::uuid[])
          RETURNING item.group_id
        )
        UPDATE skill_groups SET revision = revision + 1, updated_at = now()
        WHERE id IN (SELECT group_id FROM detached)
      `,
      [sourceIds, userId]
    );

    // Their own Sets, with items, invite lists and copy records (Favorites is one of them).
    const sets = await client.query("DELETE FROM skill_groups WHERE owner_user_id = $1", [userId]);
    deletedSets = sets.rowCount ?? 0;
    await client.query(
      "UPDATE skill_sources SET tombstoned_at = now(), updated_at = now() WHERE id = ANY($1::uuid[]) AND tombstoned_at IS NULL",
      [sourceIds]
    );

    // Synced skills and runs point at Macs without cascading, so they go first.
    await client.query("DELETE FROM synced_skills WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM sync_runs WHERE user_id = $1", [userId]);
    for (const table of [
      "install_acks", "cloud_skip_reports", "cloud_secret_holds", "cloud_skill_reviews", "cloud_save_settings",
      "device_tokens", "sync_tokens", "my_skill_additions", "library_agent_connections"
    ]) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    await client.query("UPDATE analytics_events SET actor_user_id = NULL WHERE actor_user_id = $1", [userId]);
    await client.query("UPDATE analytics_events SET profile_user_id = NULL WHERE profile_user_id = $1", [userId]);
    await client.query(`${emptyRecord} WHERE id = $1`, [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await dependencies.deleteSignIn(input.clerkUserId);
  } catch {
    throw new AccountDeleteError("sign_in_delete_failed", "Your data is deleted, but signing you out failed. Try again.");
  }
  // A request that arrived mid-delete may have made a fresh record for this sign-in; empty it too.
  await pool.query(`${emptyRecord} WHERE clerk_user_id = $1`, [input.clerkUserId]);
  return { deletedSets };
}
