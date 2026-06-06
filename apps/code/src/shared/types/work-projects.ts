import { z } from "zod";

/**
 * Project canvas types. A project's left-pane "artifact" is a composable bento
 * grid of tiles. Tiles are owned by the main process (persisted in
 * electron-store) and rendered in the renderer. A chat panel on the right of
 * the canvas can propose tile mutations as ghost tiles which the user accepts
 * or rejects.
 */

export const projectIconId = z.enum([
  "rocket",
  "microphone",
  "megaphone",
  "lightbulb",
  "compass",
  "target",
  "flask",
  "lightning",
  "sparkle",
  "globe",
]);
export type ProjectIconId = z.infer<typeof projectIconId>;

export const tileSize = z.enum(["sm", "md", "lg", "full"]);
export type TileSize = z.infer<typeof tileSize>;

/** Snap-to-grid sizing. cols 1..12, rows 1..4. When set, takes precedence
 *  over the legacy `size` enum. The renderer derives grid-column-span and
 *  grid-row-span CSS from this. */
export const gridSize = z.object({
  cols: z.number().int().min(1).max(12),
  rows: z.number().int().min(1).max(4),
});
export type GridSize = z.infer<typeof gridSize>;

/** Absolute position on the 12-col grid. x in 0..11, y in 0..N.
 *  When absent, the renderer packs the tile sequentially from order on
 *  first render and persists the result via `updateTileLayout`. */
export const gridPosition = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
});
export type GridPosition = z.infer<typeof gridPosition>;

export const tileState = z.enum([
  "live",
  "pending_add",
  "pending_remove",
  "pending_edit",
]);
export type TileState = z.infer<typeof tileState>;

export const tileOrigin = z.enum(["seed", "user", "chat"]);
export type TileOrigin = z.infer<typeof tileOrigin>;

const tileBase = z.object({
  id: z.string(),
  size: tileSize,
  state: tileState,
  origin: tileOrigin,
  gridSize: gridSize.optional(),
  /** Absolute (x, y) position on the 12-col canvas. When absent, the
   *  renderer packs tiles sequentially using `order` as a fallback. */
  gridPosition: gridPosition.optional(),
});

export const titleTile = tileBase.extend({
  type: z.literal("title"),
  iconId: projectIconId,
  name: z.string(),
  tagline: z.string(),
});
export type TitleTile = z.infer<typeof titleTile>;

/** Reference to a picked PostHog insight stored on a headline tile.
 *  `shareToken` is minted on pick (PostHog SharingConfiguration access_token)
 *  and used to embed the insight in an iframe at
 *  `{cloudUrl}/embedded/{shareToken}`. `body` is kept so we can recover or
 *  re-mint the share if it gets revoked. */
export const headlineQueryRef = z.object({
  posthogProjectId: z.number(),
  body: z.record(z.string(), z.unknown()),
  insightShortId: z.string().optional(),
  shareToken: z.string().optional(),
});
export type HeadlineQueryRef = z.infer<typeof headlineQueryRef>;

export const headlineTile = tileBase.extend({
  type: z.literal("headline"),
  label: z.string(),
  /** Display label for the live mode, falls back to `label` when absent. */
  liveLabel: z.string().optional(),
  /** Fallback values shown pre-auth or while the query is loading. */
  fallbackValue: z.string(),
  fallbackDelta: z.string(),
  fallbackSparkline: z.array(z.number()),
  /** Present when the user has chosen an insight via the picker; absent for
   *  fresh agent-proposed tiles which still render fallback values. */
  query: headlineQueryRef.optional(),
  posthogUrl: z.string().optional(),
});
export type HeadlineTile = z.infer<typeof headlineTile>;

/** Patch shape accepted by `updateHeadlineTile` across the renderer, tRPC
 *  router, and main-process service. Each field is independently optional;
 *  the service merges set fields into the persisted tile. */
export interface HeadlineTilePatch {
  label?: string;
  liveLabel?: string;
  query?: HeadlineQueryRef;
  posthogUrl?: string;
  fallbackValue?: string;
  fallbackDelta?: string;
  fallbackSparkline?: number[];
}

export const insightTile = tileBase.extend({
  type: z.literal("insight"),
  /** Either a dashboard or an insight reference. */
  posthogProjectId: z.number(),
  dashboardId: z.number().optional(),
  insightId: z.number().optional(),
  shortId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  url: z.string(),
});
export type InsightTile = z.infer<typeof insightTile>;

export const fileListItem = z.object({
  /** Absolute path on the user's machine. */
  path: z.string(),
  /** ISO timestamp when the user added this file to the tile. */
  addedAt: z.string(),
});
export type FileListItem = z.infer<typeof fileListItem>;

export const fileTile = tileBase.extend({
  type: z.literal("file"),
  /** Optional title shown in the tile header. Falls back to "Files". */
  title: z.string().optional(),
  /** Defaults to `[]` so legacy persisted tiles (without `items`) still
   *  parse cleanly while the main-process migration backfills storage. */
  items: z.array(fileListItem).default([]),
});
export type FileTile = z.infer<typeof fileTile>;

export const noteTile = tileBase.extend({
  type: z.literal("note"),
  body: z.string(),
  /** Visual tone for the sticky-note background. */
  tone: z
    .enum(["yellow", "blue", "green", "pink", "neutral"])
    .default("yellow"),
});
export type NoteTile = z.infer<typeof noteTile>;

/** Artifact tile — a single tile type whose `kind` selects the renderer.
 *  The data payload is per-kind and loosely typed at the schema layer; the
 *  renderer is defensive when reading it. Lets the agent (and skills) create
 *  rich tile content without growing the discriminated union. */
export const artifactKind = z.enum([
  "checklist",
  "table",
  "chart",
  "code",
  "embed",
]);
export type ArtifactKind = z.infer<typeof artifactKind>;

export const artifactTile = tileBase.extend({
  type: z.literal("artifact"),
  kind: artifactKind,
  title: z.string().max(80),
  /** Per-kind payload. Shapes documented in the MCP tool description and in
   *  the renderer's per-kind components. */
  data: z.record(z.string(), z.unknown()),
});
export type ArtifactTile = z.infer<typeof artifactTile>;

export const githubActivityType = z.enum([
  "pr_merged",
  "pr_opened",
  "issue_opened",
  "release",
]);
export type GithubActivityType = z.infer<typeof githubActivityType>;

export const githubActivityItem = z.object({
  id: z.string(),
  type: githubActivityType,
  title: z.string(),
  url: z.string(),
  actor: z.string().optional(),
  /** ISO timestamp. */
  when: z.string(),
});
export type GithubActivityItem = z.infer<typeof githubActivityItem>;

/** Latest release info — surfaced as a standalone metric on the tile rather
 *  than mixed into the recent feed, since releases happen on a cadence that
 *  doesn't fit the lookback window. */
export const githubLatestRelease = z.object({
  name: z.string().nullable(),
  tagName: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string(),
});
export type GithubLatestRelease = z.infer<typeof githubLatestRelease>;

export const githubActivitySummary = z.object({
  /** ISO timestamp of the last successful (or failed) fetch. */
  fetchedAt: z.string(),
  /** Window the summary covers, in days. */
  windowDays: z.number().int().min(1).max(90),
  counts: z.object({
    pr_merged: z.number().int().nonnegative(),
    pr_opened: z.number().int().nonnegative(),
    issue_opened: z.number().int().nonnegative(),
  }),
  /** Most recent release on the repo, regardless of lookback window. */
  latestRelease: githubLatestRelease.optional(),
  /** Interleaved recent PRs and issues, sorted desc by `when`. Releases
   *  are NOT included — they have their own card. */
  recent: z.array(githubActivityItem),
  /** Set when the fetch failed (gh not installed, not authed, repo missing). */
  error: z.string().optional(),
});
export type GithubActivitySummary = z.infer<typeof githubActivitySummary>;

export const githubActivityTile = tileBase.extend({
  type: z.literal("github_activity"),
  /** Watched repo. Undefined → empty/config mode in the renderer. */
  repo: z
    .object({
      owner: z.string(),
      name: z.string(),
    })
    .optional(),
  /** Activity types to include in counts and the recent feed. */
  enabledTypes: z.array(githubActivityType).min(1),
  /** Lookback window in days for counts and the recent feed. */
  windowDays: z.number().int().min(1).max(90),
  /** Last fetched summary, populated by the main process. */
  summary: githubActivitySummary.optional(),
});
export type GithubActivityTile = z.infer<typeof githubActivityTile>;

export const tile = z.discriminatedUnion("type", [
  titleTile,
  headlineTile,
  insightTile,
  fileTile,
  noteTile,
  artifactTile,
  githubActivityTile,
]);
export type Tile = z.infer<typeof tile>;
export type TileType = Tile["type"];

export const projectMember = z.object({
  name: z.string(),
  initials: z.string(),
});
export type ProjectMember = z.infer<typeof projectMember>;

export const workProject = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  iconId: projectIconId,
  members: z.array(projectMember),
  tiles: z.array(tile),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Starter prompt to auto-fire as the first chat message when the project's
   *  chat panel mounts. Cleared by the renderer once the chat has been kicked
   *  off so it never replays. */
  pendingPrompt: z.string().optional(),
  /** Suggested next-step prompts the agent sets at the end of each turn via
   *  the `set_next_steps` canvas tool. The renderer renders these as clickable
   *  chips below the chat. Replaced each turn. */
  nextSteps: z.array(z.string()).optional(),
  /** ISO timestamp when the user pinned the project. Sortable. When set, the
   *  project appears in the sidebar's pinned subtree and the home "Pinned"
   *  rail. */
  pinnedAt: z.string().optional(),
  /** ISO timestamp set when the user triggers a delete with undo. While set,
   *  the project is hidden from `list()` and from project-changed
   *  subscriptions. After the undo grace period elapses (handled by the
   *  renderer toast), the project is hard-committed via `commitDelete`. On
   *  app boot, any project with `pendingDeletionAt` older than 30s is
   *  auto-committed (recovery from crashes during the grace window). */
  pendingDeletionAt: z.string().optional(),
  /** ISO timestamp when the user archived the project. Archived projects are
   *  hidden from `list()` but surfaced in `listArchived()` so the user can
   *  browse and restore them. No auto-commit – archive is durable. */
  archivedAt: z.string().optional(),
});
export type WorkProject = z.infer<typeof workProject>;

/** Patch shape used by add-tile mutations. The caller passes the type-specific
 *  fields; the service assigns an id, state, origin, and a default size. */
export const newTileInput = z.discriminatedUnion("type", [
  titleTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  headlineTile
    .omit({ id: true, state: true, origin: true, size: true })
    .extend({
      size: tileSize.optional(),
    }),
  insightTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  fileTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  noteTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  artifactTile
    .omit({ id: true, state: true, origin: true, size: true })
    .extend({
      size: tileSize.optional(),
    }),
  githubActivityTile
    .omit({ id: true, state: true, origin: true, size: true })
    .extend({
      size: tileSize.optional(),
    }),
]);
export type NewTileInput = z.infer<typeof newTileInput>;

export const createProjectInput = z.object({
  name: z.string().optional(),
  tagline: z.string().optional(),
  iconId: projectIconId.optional(),
  fromPrompt: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const tileSizeChange = z.object({
  tileId: z.string(),
  size: tileSize,
});

export const tileMove = z.object({
  tileId: z.string(),
  toIndex: z.number().int().min(0),
});

export type WorkProjectsEvents = {
  "project-changed": { projectId: string };
  "projects-changed": undefined;
};
