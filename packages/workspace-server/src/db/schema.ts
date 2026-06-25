import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => text().notNull().default(sql`(CURRENT_TIMESTAMP)`);
const updatedAt = () => text().notNull().default(sql`(CURRENT_TIMESTAMP)`);

export const repositories = sqliteTable("repositories", {
  id: id(),
  path: text().notNull().unique(),
  remoteUrl: text(),
  lastAccessedAt: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: id(),
    taskId: text().notNull().unique(),
    repositoryId: text().references(() => repositories.id, {
      onDelete: "set null",
    }),
    mode: text({ enum: ["cloud", "local", "worktree"] }).notNull(),
    linkedBranch: text(),
    pinnedAt: text(),
    lastViewedAt: text(),
    lastActivityAt: text(),
    /** JSON-encoded array of absolute paths the agent can access for this task. */
    additionalDirectories: text().notNull().default("[]"),
    /** Cached PR URL for this task so task switches render without waiting on `gh`. */
    prUrl: text(),
    /** Cached PR state — values match the `SidebarPrState` union (open/merged/closed/draft). */
    prState: text({ enum: ["open", "merged", "closed", "draft"] }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workspaces_repository_id_idx").on(t.repositoryId)],
);

// Pin / view / activity metadata for tasks that have no `workspaces` row —
// repo-less channel tasks (e.g. canvas generation) whose working dir is a
// scratch dir, not a tracked workspace. Tasks WITH a workspace row keep this
// metadata on their workspace row; this table is the fallback home so the
// per-device viewed/pinned state survives reload for the rowless ones too.
export const taskMetadata = sqliteTable("task_metadata", {
  taskId: text().primaryKey(),
  pinnedAt: text(),
  lastViewedAt: text(),
  lastActivityAt: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const worktrees = sqliteTable("worktrees", {
  id: id(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text().notNull(),
  path: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const archives = sqliteTable("archives", {
  id: id(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  branchName: text(),
  checkpointId: text(),
  archivedAt: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const suspensions = sqliteTable("suspensions", {
  id: id(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  branchName: text(),
  checkpointId: text(),
  suspendedAt: text().notNull(),
  reason: text({
    enum: ["max_worktrees", "inactivity", "manual"],
  }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: integer().primaryKey(),
  refreshTokenEncrypted: text().notNull(),
  cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
  selectedProjectId: integer(),
  scopeVersion: integer().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const defaultAdditionalDirectories = sqliteTable(
  "default_additional_directories",
  {
    path: text().primaryKey(),
    createdAt: createdAt(),
  },
);

export const authPreferences = sqliteTable(
  "auth_preferences",
  {
    accountKey: text().notNull(),
    cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
    lastSelectedProjectId: integer(),
    lastSelectedOrgId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_preferences_account_region_idx").on(
      t.accountKey,
      t.cloudRegion,
    ),
  ],
);

export const authOrgProjectPreferences = sqliteTable(
  "auth_org_project_preferences",
  {
    accountKey: text().notNull(),
    cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
    orgId: text().notNull(),
    lastSelectedProjectId: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_org_project_account_region_org_idx").on(
      t.accountKey,
      t.cloudRegion,
      t.orgId,
    ),
  ],
);
