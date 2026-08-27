import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    handle: text("handle"),
    handleUpdatedAt: timestamp("handle_updated_at", { withTimezone: true }),
    profilePublished: boolean("profile_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("users_clerk_user_id_unique").on(table.clerkUserId),
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_handle_unique").on(table.handle)
  ]
);

export const skillSources = pgTable(
  "skill_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    normalizedRoot: text("normalized_root").notNull(),
    catalogSkillId: text("catalog_skill_id"),
    repositoryId: text("repository_id"),
    repositorySlug: text("repository_slug"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "restrict" }),
    brokerInstallationId: text("broker_installation_id"),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "skill_sources_kind_check",
      sql`${table.kind} IN ('catalog', 'public_github', 'private_github')`
    ),
    check(
      "skill_sources_root_check",
      sql`char_length(${table.normalizedRoot}) BETWEEN 1 AND 1000
        AND ${table.normalizedRoot} = btrim(${table.normalizedRoot})
        AND ${table.normalizedRoot} NOT LIKE '/%'
        AND ${table.normalizedRoot} NOT LIKE '%/'
        AND ${table.normalizedRoot} NOT LIKE '%//%'
        AND strpos(${table.normalizedRoot}, chr(92)) = 0`
    ),
    check(
      "skill_sources_shape_check",
      sql`(
          ${table.kind} = 'catalog'
          AND ${table.catalogSkillId} IS NOT NULL
          AND ${table.repositoryId} IS NULL
          AND ${table.repositorySlug} IS NULL
          AND ${table.ownerUserId} IS NULL
          AND ${table.brokerInstallationId} IS NULL
        ) OR (
          ${table.kind} = 'public_github'
          AND ${table.catalogSkillId} IS NULL
          AND ${table.repositoryId} IS NOT NULL
          AND ${table.repositorySlug} IS NOT NULL
          AND ${table.ownerUserId} IS NULL
          AND ${table.brokerInstallationId} IS NULL
        ) OR (
          ${table.kind} = 'private_github'
          AND ${table.catalogSkillId} IS NULL
          AND ${table.repositoryId} IS NOT NULL
          AND ${table.repositorySlug} IS NOT NULL
          AND ${table.ownerUserId} IS NOT NULL
          AND ${table.brokerInstallationId} IS NOT NULL
        )`
    ),
    uniqueIndex("skill_sources_catalog_unique")
      .on(table.catalogSkillId)
      .where(sql`${table.kind} = 'catalog'`),
    uniqueIndex("skill_sources_github_unique")
      .on(table.kind, table.repositoryId, table.normalizedRoot)
      .where(sql`${table.kind} IN ('public_github', 'private_github')`),
    index("skill_sources_owner_idx").on(table.ownerUserId),
    index("skill_sources_repository_idx").on(table.repositoryId)
  ]
);

export const skillReleases = pgTable(
  "skill_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").notNull().references(() => skillSources.id, { onDelete: "restrict" }),
    commitSha: text("commit_sha").notNull(),
    treeSha: text("tree_sha").notNull(),
    skillMdSha: text("skill_md_sha").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "skill_releases_sha_check",
      sql`${table.commitSha} ~ '^[0-9a-f]{40}$'
        AND ${table.treeSha} ~ '^[0-9a-f]{40}$'
        AND ${table.skillMdSha} ~ '^[0-9a-f]{40}$'`
    ),
    check(
      "skill_releases_creator_check",
      sql`char_length(${table.createdBy}) BETWEEN 1 AND 500
        AND ${table.createdBy} = btrim(${table.createdBy})`
    ),
    uniqueIndex("skill_releases_source_coordinates_unique").on(
      table.sourceId,
      table.commitSha,
      table.treeSha,
      table.skillMdSha
    ),
    uniqueIndex("skill_releases_id_source_unique").on(table.id, table.sourceId),
    index("skill_releases_source_created_idx").on(table.sourceId, table.createdAt)
  ]
);

export const skillGroups = pgTable(
  "skill_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug").notNull(),
    visibility: text("visibility").notNull().default("private"),
    revision: integer("revision").notNull().default(1),
    isFavorites: boolean("is_favorites").notNull().default(false),
    showOwnerName: boolean("show_owner_name").notNull().default(false),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("skill_groups_owner_slug_unique").on(table.ownerUserId, table.slug),
    index("skill_groups_owner_idx").on(table.ownerUserId),
    index("skill_groups_visibility_idx").on(table.visibility),
    check("skill_groups_revision_check", sql`${table.revision} > 0`)
  ]
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [index("sync_runs_user_idx").on(table.userId)]
);

export const syncedSkills = pgTable(
  "synced_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
    stableKey: text("stable_key").notNull(),
    skillMdSha: text("skill_md_sha"),
    identityStatus: text("identity_status").notNull().default("localOnly"),
    name: text("name").notNull(),
    description: text("description"),
    catalogSkillId: text("catalog_skill_id"),
    githubUrl: text("github_url"),
    isLocalOnly: boolean("is_local_only").notNull().default(false),
    source: text("source").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("synced_skills_user_stable_key_unique").on(table.userId, table.stableKey),
    index("synced_skills_user_current_idx").on(table.userId, table.isCurrent),
    check(
      "synced_skills_identity_consistency_check",
      sql`(${table.identityStatus} = 'resolved' AND ${table.catalogSkillId} IS NOT NULL AND ${table.isLocalOnly} = false)
        OR (${table.identityStatus} = 'ambiguous' AND ${table.catalogSkillId} IS NULL AND ${table.isLocalOnly} = false)
        OR (${table.identityStatus} = 'localOnly' AND ${table.catalogSkillId} IS NULL AND ${table.isLocalOnly} = true)`
    )
  ]
);

export const skillGroupItems = pgTable(
  "skill_group_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => skillGroups.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    syncedSkillId: uuid("synced_skill_id").references(() => syncedSkills.id, { onDelete: "set null" }),
    catalogSkillId: text("catalog_skill_id"),
    githubUrl: text("github_url"),
    name: text("name"),
    description: text("description"),
    note: text("note"),
    sourceId: uuid("source_id").references(() => skillSources.id, { onDelete: "restrict" }),
    releaseId: uuid("release_id").references(() => skillReleases.id, { onDelete: "restrict" }),
    metadataOnlyReason: text("metadata_only_reason"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("skill_group_items_group_position_idx").on(table.groupId, table.position),
    index("skill_group_items_source_idx").on(table.sourceId),
    index("skill_group_items_release_idx").on(table.releaseId),
    check(
      "skill_group_items_release_state_check",
      sql`(
          ${table.sourceId} IS NULL
          AND ${table.releaseId} IS NULL
          AND ${table.metadataOnlyReason} IS NULL
        ) OR (
          ${table.sourceId} IS NOT NULL
          AND ${table.releaseId} IS NOT NULL
          AND ${table.metadataOnlyReason} IS NULL
        ) OR (
          ${table.releaseId} IS NULL
          AND ${table.metadataOnlyReason} IS NOT NULL
          AND char_length(btrim(${table.metadataOnlyReason})) BETWEEN 1 AND 200
        )`
    ),
    foreignKey({
      columns: [table.releaseId, table.sourceId],
      foreignColumns: [skillReleases.id, skillReleases.sourceId],
      name: "skill_group_items_release_source_fk"
    }).onDelete("restrict")
  ]
);

export const skillGroupAllowedEmails = pgTable(
  "skill_group_allowed_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => skillGroups.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("skill_group_allowed_emails_group_email_unique").on(table.groupId, table.email),
    index("skill_group_allowed_emails_email_idx").on(table.email)
  ]
);

export const skillGroupCopies = pgTable("skill_group_copies", {
  id: uuid("id").primaryKey().defaultRandom(),
  newGroupId: uuid("new_group_id").notNull().references(() => skillGroups.id, { onDelete: "cascade" }),
  sourceGroupId: uuid("source_group_id").references(() => skillGroups.id, { onDelete: "set null" }),
  sourceOwnerHandle: text("source_owner_handle"),
  sourceGroupSlug: text("source_group_slug"),
  sourceOwnerDisplayName: text("source_owner_display_name"),
  copiedAt: timestamp("copied_at", { withTimezone: true }).notNull().defaultNow()
});

export const syncTokens = pgTable(
  "sync_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull().default("legacy_upload"),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("sync_tokens_token_hash_unique").on(table.tokenHash),
    index("sync_tokens_user_idx").on(table.userId),
    check(
      "sync_tokens_purpose_check",
      sql`${table.purpose} IN ('legacy_upload', 'device_exchange')`
    ),
    check(
      "sync_tokens_challenge_check",
      sql`(${table.codeChallenge} IS NULL AND ${table.codeChallengeMethod} IS NULL)
        OR (${table.purpose} = 'device_exchange' AND ${table.codeChallenge} IS NOT NULL AND ${table.codeChallengeMethod} = 'S256')`
    )
  ]
);

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    deviceName: text("device_name").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("device_tokens_token_hash_unique").on(table.tokenHash),
    index("device_tokens_user_idx").on(table.userId),
    index("device_tokens_user_active_idx")
      .on(table.userId, table.createdAt)
      .where(sql`${table.revokedAt} IS NULL`),
    check(
      "device_tokens_name_check",
      sql`char_length(${table.deviceName}) BETWEEN 1 AND 100 AND ${table.deviceName} = btrim(${table.deviceName})`
    ),
    check(
      "device_tokens_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`
    )
  ]
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventName: text("event_name").notNull(),
    groupId: uuid("group_id").references(() => skillGroups.id, { onDelete: "set null" }),
    profileUserId: uuid("profile_user_id").references(() => users.id, { onDelete: "set null" }),
    skillItemId: uuid("skill_item_id").references(() => skillGroupItems.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("analytics_events_name_created_idx").on(table.eventName, table.createdAt)
  ]
);
