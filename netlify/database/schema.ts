import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

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

export const skillGroups = pgTable(
  "skill_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug").notNull(),
    visibility: text("visibility").notNull().default("private"),
    isFavorites: boolean("is_favorites").notNull().default(false),
    showOwnerName: boolean("show_owner_name").notNull().default(false),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("skill_groups_owner_slug_unique").on(table.ownerUserId, table.slug),
    index("skill_groups_owner_idx").on(table.ownerUserId),
    index("skill_groups_visibility_idx").on(table.visibility)
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
    index("synced_skills_user_current_idx").on(table.userId, table.isCurrent)
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
    note: text("note"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("skill_group_items_group_position_idx").on(table.groupId, table.position)
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
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("sync_tokens_token_hash_unique").on(table.tokenHash),
    index("sync_tokens_user_idx").on(table.userId)
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
