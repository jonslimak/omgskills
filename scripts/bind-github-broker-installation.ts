#!/usr/bin/env node

import pg from "pg";
import { fileURLToPath } from "node:url";
import { GitHubBrokerClient } from "../netlify/functions/_shared/github-broker.js";
import { bindGithubBrokerInstallation } from "../netlify/functions/_shared/private-sources.js";

type Options = {
  installationId: string;
  expectedAccount: string;
  ownerId?: string;
  ownerEmail?: string;
  apply: boolean;
};

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseBindingOptions(args: string[]): Options {
  const installationId = valueAfter(args, "--installation-id")?.trim() ?? "";
  const expectedAccount = valueAfter(args, "--expected-account")?.trim() ?? "";
  const ownerId = valueAfter(args, "--owner-id")?.trim();
  const ownerEmail = valueAfter(args, "--owner-email")?.trim().toLowerCase();
  if (!/^[0-9]+$/.test(installationId)) throw new Error("--installation-id is required");
  if (!expectedAccount) throw new Error("--expected-account is required");
  if (Boolean(ownerId) === Boolean(ownerEmail)) {
    throw new Error("Provide exactly one of --owner-id or --owner-email");
  }
  return { installationId, expectedAccount, ownerId, ownerEmail, apply: args.includes("--apply") };
}

export async function bindInstallation(options: Options): Promise<{ applied: boolean; ownerId: string }> {
  const connectionString = process.env.SKILLGROUPS_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("SKILLGROUPS_DATABASE_URL is required");

  const installation = await new GitHubBrokerClient().getInstallation(options.installationId);
  if (installation.accountLogin.toLowerCase() !== options.expectedAccount.toLowerCase()) {
    throw new Error("GitHub installation account does not match --expected-account");
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const owner = await pool.query<{ id: string }>(
      options.ownerId
        ? "SELECT id FROM users WHERE id = $1"
        : "SELECT id FROM users WHERE email = $1",
      [options.ownerId ?? options.ownerEmail]
    );
    if (owner.rowCount !== 1) throw new Error("Exactly one omgskills owner must match");
    const ownerId = owner.rows[0].id;
    if (!options.apply) return { applied: false, ownerId };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await bindGithubBrokerInstallation(client, { ownerUserId: ownerId, ...installation });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { applied: true, ownerId };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bindInstallation(parseBindingOptions(process.argv.slice(2)))
    .then((result) => {
      console.log(
        result.applied
          ? `Broker installation bound to owner ${result.ownerId}`
          : `Dry run passed for owner ${result.ownerId}; rerun with --apply to save`
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Broker installation binding failed");
      process.exit(1);
    });
}
