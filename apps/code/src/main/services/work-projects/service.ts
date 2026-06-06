import type {
  CreateProjectInput,
  GithubActivitySummary,
  GithubActivityType,
  GridSize,
  HeadlineTilePatch,
  NewTileInput,
  ProjectIconId,
  Tile,
  TileSize,
  WorkProject,
  WorkProjectsEvents,
} from "@shared/types/work-projects";
import Store from "electron-store";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { getUserDataDir } from "../../utils/env";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { LlmGatewayService } from "../llm-gateway/service";

const log = logger.scope("work-projects-service");

const PROJECT_ICONS = [
  "rocket",
  "microphone",
  "megaphone",
  "lightbulb",
  "compass",
  "target",
  "flask",
] as const satisfies readonly ProjectIconId[];

const AUTO_NAME_SYSTEM = `You name PostHog Code projects. Given the user's
opening prompt, reply with ONLY a JSON object — no prose, no markdown — with
keys: "name" (≤3 words, Title Case), "tagline" (≤8 words, sentence case, no
trailing period), "iconId" (one of: rocket, microphone, megaphone, lightbulb,
compass, target, flask — pick the closest match for the topic).`;

/** Persisted snapshot: single key so reads/writes are atomic. */
interface WorkProjectsState {
  seeded: boolean;
  projects: Record<string, WorkProject>;
  /** Stable ordering of project ids (newest first when user-created). */
  order: string[];
}

interface WorkProjectsStoreSchema {
  /** New single-key state (atomic). */
  state?: WorkProjectsState;
  /** Legacy keys, migrated to `state` on first read after upgrade. */
  seeded?: boolean;
  projects?: Record<string, WorkProject>;
  order?: string[];
}

/** Grace window after which a `pendingDeletionAt` is hard-committed on boot. */
const STALE_DELETION_MS = 30_000;

function newId(prefix: string): string {
  const rand =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand}`;
}

function defaultSizeFor(type: NewTileInput["type"]): TileSize {
  switch (type) {
    case "title":
      return "full";
    case "headline":
      return "md";
    case "insight":
      return "md";
    case "file":
      return "md";
    case "note":
      return "sm";
    case "artifact":
      return "md";
    case "github_activity":
      return "lg";
  }
}

@injectable()
export class WorkProjectsService extends TypedEventEmitter<WorkProjectsEvents> {
  private readonly store: Store<WorkProjectsStoreSchema>;

  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llmGateway: LlmGatewayService,
  ) {
    super();
    this.store = new Store<WorkProjectsStoreSchema>({
      name: "work-projects",
      cwd: getUserDataDir(),
      defaults: {},
    });

    this.migrateLegacyKeysIfNeeded();
    this.migrateLegacyFileTilesIfNeeded();
    this.ensureSeeded();
    this.recoverStaleDeletions();
  }

  /** One-time migration: convert legacy single-file tiles (filename + contents)
   *  to the new list-of-paths shape. Old inline content is discarded. Idempotent
   *  — bails as soon as a tile already has `items`. */
  private migrateLegacyFileTilesIfNeeded(): void {
    const state = this.readState();
    let changed = false;
    for (const id of state.order) {
      const project = state.projects[id];
      if (!project) continue;
      const nextTiles = project.tiles.map((t) => {
        if (t.type !== "file") return t;
        const tileRecord = t as unknown as Record<string, unknown>;
        if (Array.isArray(tileRecord.items)) return t;
        const {
          filename: _legacyName,
          contents: _legacyContents,
          ...rest
        } = tileRecord;
        changed = true;
        return { ...rest, items: [] } as unknown as Tile;
      });
      if (changed) {
        state.projects[id] = { ...project, tiles: nextTiles };
      }
    }
    if (changed) {
      this.writeState(state);
      log.info("Migrated legacy file tiles to file-list shape");
    }
  }

  /** One-time migration: collapse legacy `seeded`/`projects`/`order` keys
   *  into the new atomic `state` key. */
  private migrateLegacyKeysIfNeeded(): void {
    if (this.store.get("state")) return;
    const legacyProjects = this.store.get("projects");
    const legacyOrder = this.store.get("order");
    const legacySeeded = this.store.get("seeded");
    if (legacyProjects || legacyOrder || legacySeeded !== undefined) {
      const state: WorkProjectsState = {
        seeded: legacySeeded ?? false,
        projects: legacyProjects ?? {},
        order: legacyOrder ?? [],
      };
      this.store.set("state", state);
      this.store.delete("projects" as never);
      this.store.delete("order" as never);
      this.store.delete("seeded" as never);
      log.info("Migrated legacy work-projects keys to atomic state");
    }
  }

  /** Read snapshot — returned object is a fresh copy callers can mutate. */
  private readState(): WorkProjectsState {
    const current = this.store.get("state");
    if (!current) {
      return { seeded: false, projects: {}, order: [] };
    }
    return {
      seeded: current.seeded,
      projects: { ...current.projects },
      order: [...current.order],
    };
  }

  /** Atomic write. Single `store.set` call. */
  private writeState(state: WorkProjectsState): void {
    this.store.set("state", state);
  }

  /** On boot, commit any project whose pendingDeletionAt has aged past the
   *  grace window. This handles app crashes during the 5s undo window. */
  private recoverStaleDeletions(): void {
    const state = this.readState();
    const now = Date.now();
    let changed = false;
    for (const id of [...state.order]) {
      const project = state.projects[id];
      if (!project?.pendingDeletionAt) continue;
      const at = Date.parse(project.pendingDeletionAt);
      if (Number.isFinite(at) && now - at >= STALE_DELETION_MS) {
        delete state.projects[id];
        state.order = state.order.filter((x) => x !== id);
        changed = true;
        log.info("Recovered stale pending deletion", { projectId: id });
      }
    }
    if (changed) {
      this.writeState(state);
      this.emit("projects-changed", undefined);
    }
  }

  private async deriveProjectMeta(fromPrompt: string): Promise<{
    name: string;
    tagline: string;
    iconId: ProjectIconId;
  } | null> {
    try {
      const result = await this.llmGateway.prompt(
        [{ role: "user", content: fromPrompt }],
        {
          system: AUTO_NAME_SYSTEM,
          model: "claude-haiku-4-5",
          maxTokens: 150,
        },
      );
      const raw = result.content.trim();
      // Tolerate accidental markdown fences.
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
        name?: unknown;
        tagline?: unknown;
        iconId?: unknown;
      };
      const name =
        typeof parsed.name === "string" && parsed.name.trim().length > 0
          ? parsed.name.trim().slice(0, 48)
          : null;
      const tagline =
        typeof parsed.tagline === "string" && parsed.tagline.trim().length > 0
          ? parsed.tagline.trim().replace(/\.+$/, "").slice(0, 80)
          : null;
      const iconId =
        typeof parsed.iconId === "string" &&
        (PROJECT_ICONS as readonly string[]).includes(parsed.iconId)
          ? (parsed.iconId as ProjectIconId)
          : null;
      if (!name || !tagline || !iconId) return null;
      return { name, tagline, iconId };
    } catch (error) {
      log.warn("Auto-name LLM call failed", { error });
      return null;
    }
  }

  private ensureSeeded(): void {
    const state = this.readState();
    if (state.seeded) return;
    // No demo projects are seeded. New users start with a genuine empty
    // workspace and onboard via the real empty state. The `seeded` guard is
    // retained so real first-run onboarding content can be added here later.
    state.seeded = true;
    this.writeState(state);
  }

  private emitProjectChanged(projectId: string): void {
    this.emit("project-changed", { projectId });
    this.emit("projects-changed", undefined);
  }

  /** Synchronous read-modify-write under a single atomic store write.
   *  JS is single-threaded so two synchronous mutators can't interleave;
   *  combined with the single-key write, this is race-free. */
  private mutateProject(
    projectId: string,
    mutator: (project: WorkProject) => WorkProject | null,
  ): WorkProject | null {
    const state = this.readState();
    const current = state.projects[projectId];
    if (!current) {
      log.warn("Project not found", { projectId });
      return null;
    }
    // Hidden (pending deletion) projects are not mutable from external paths.
    if (current.pendingDeletionAt) {
      log.warn("Project is pending deletion, mutation skipped", { projectId });
      return null;
    }
    const next = mutator(current);
    if (!next) return current;
    const stamped: WorkProject = {
      ...next,
      updatedAt: new Date().toISOString(),
    };
    state.projects[projectId] = stamped;
    this.writeState(state);
    this.emitProjectChanged(projectId);
    return stamped;
  }

  list(): WorkProject[] {
    const state = this.readState();
    return state.order
      .map((id) => state.projects[id])
      .filter(
        (p): p is WorkProject => !!p && !p.pendingDeletionAt && !p.archivedAt,
      );
  }

  /** Projects the user has archived, most-recently-archived first. Pending-
   *  deletion projects are still excluded (those are mid-undo and shouldn't
   *  appear in either list). */
  listArchived(): WorkProject[] {
    const state = this.readState();
    return state.order
      .map((id) => state.projects[id])
      .filter(
        (p): p is WorkProject => !!p && !!p.archivedAt && !p.pendingDeletionAt,
      )
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }

  get(projectId: string): WorkProject | null {
    const state = this.readState();
    const project = state.projects[projectId];
    if (!project || project.pendingDeletionAt) return null;
    return project;
  }

  async create(input: CreateProjectInput): Promise<WorkProject> {
    const id = newId("project");
    const now = new Date().toISOString();
    const trimmedPrompt = input.fromPrompt?.trim();

    // Default values first; if we have a starter prompt, ask the LLM gateway
    // for a derived name/tagline/icon and overlay them. Falls back gracefully.
    let name = input.name?.trim() || "Untitled project";
    let tagline = input.tagline?.trim() || "Just started";
    let iconId: ProjectIconId = input.iconId ?? "lightbulb";

    if (trimmedPrompt && !input.name && !input.tagline) {
      const derived = await this.deriveProjectMeta(trimmedPrompt);
      if (derived) {
        name = derived.name;
        tagline = derived.tagline;
        iconId = derived.iconId;
        log.info("Auto-named project from prompt", { id, name, iconId });
      }
    }

    const titleTile: Tile = {
      id: newId("tile"),
      type: "title",
      size: "full",
      state: "live",
      origin: "seed",
      iconId,
      name,
      tagline,
    };

    const project: WorkProject = {
      id,
      name,
      tagline,
      iconId,
      members: [],
      tiles: [titleTile],
      createdAt: now,
      updatedAt: now,
      ...(trimmedPrompt ? { pendingPrompt: trimmedPrompt } : {}),
    };

    const state = this.readState();
    state.projects[id] = project;
    state.order = [id, ...state.order];
    this.writeState(state);
    this.emitProjectChanged(id);
    return project;
  }

  /** Create a project from a built-in template: instantiates the prebuilt
   *  tiles, sets meta from the template, and stamps the opening prompt as
   *  `pendingPrompt` so the chat panel auto-fires it on mount. */
  createFromTemplate(template: {
    name: string;
    tagline: string;
    iconId: ProjectIconId;
    tiles: NewTileInput[];
    openingPrompt: string;
  }): WorkProject {
    const id = newId("project");
    const now = new Date().toISOString();
    const titleTile: Tile = {
      id: newId("tile"),
      type: "title",
      size: "full",
      state: "live",
      origin: "seed",
      iconId: template.iconId,
      name: template.name,
      tagline: template.tagline,
    };
    const contentTiles: Tile[] = template.tiles.map(
      (t) =>
        ({
          ...t,
          id: newId("tile"),
          size: t.size ?? defaultSizeFor(t.type),
          state: "live",
          origin: "seed",
        }) as Tile,
    );
    const project: WorkProject = {
      id,
      name: template.name,
      tagline: template.tagline,
      iconId: template.iconId,
      members: [],
      tiles: [titleTile, ...contentTiles],
      createdAt: now,
      updatedAt: now,
      pendingPrompt: template.openingPrompt,
    };
    const state = this.readState();
    state.projects[id] = project;
    state.order = [id, ...state.order];
    this.writeState(state);
    this.emitProjectChanged(id);
    return project;
  }

  /** Mark a project as pending deletion. Removes it from `list()` and
   *  hides it from project-changed subscribers, but keeps the data so an
   *  undo can restore it. */
  softDelete(projectId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => ({
      ...project,
      pendingDeletionAt: new Date().toISOString(),
    }));
  }

  /** Restore a soft-deleted project. */
  undoDelete(projectId: string): WorkProject | null {
    const state = this.readState();
    const current = state.projects[projectId];
    if (!current || !current.pendingDeletionAt) return null;
    const { pendingDeletionAt: _drop, ...restored } = current;
    state.projects[projectId] = {
      ...(restored as WorkProject),
      updatedAt: new Date().toISOString(),
    };
    this.writeState(state);
    this.emitProjectChanged(projectId);
    return state.projects[projectId];
  }

  /** Permanently remove a soft-deleted project. */
  commitDelete(projectId: string): void {
    const state = this.readState();
    if (!state.projects[projectId]) return;
    delete state.projects[projectId];
    state.order = state.order.filter((id) => id !== projectId);
    this.writeState(state);
    this.emit("projects-changed", undefined);
  }

  /** Archive a project. Hides it from `list()` and surfaces it in
   *  `listArchived()`. Bypasses `mutateProject`'s pinned-only guard but
   *  still respects pending-deletion. */
  archive(projectId: string): WorkProject | null {
    const state = this.readState();
    const current = state.projects[projectId];
    if (!current || current.pendingDeletionAt) return null;
    if (current.archivedAt) return current;
    const next: WorkProject = {
      ...current,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.projects[projectId] = next;
    this.writeState(state);
    this.emitProjectChanged(projectId);
    return next;
  }

  /** Unarchive (restore) a project. */
  unarchive(projectId: string): WorkProject | null {
    const state = this.readState();
    const current = state.projects[projectId];
    if (!current || !current.archivedAt) return null;
    const { archivedAt: _drop, ...rest } = current;
    const next: WorkProject = {
      ...(rest as WorkProject),
      updatedAt: new Date().toISOString(),
    };
    state.projects[projectId] = next;
    this.writeState(state);
    this.emitProjectChanged(projectId);
    return next;
  }

  pinProject(projectId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      if (project.pinnedAt) return null;
      return { ...project, pinnedAt: new Date().toISOString() };
    });
  }

  unpinProject(projectId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      if (!project.pinnedAt) return null;
      const { pinnedAt: _drop, ...rest } = project;
      return rest as WorkProject;
    });
  }

  setNextSteps(projectId: string, prompts: string[]): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const cleaned = prompts
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter((p) => p.length > 0)
        .slice(0, 3);
      if (cleaned.length === 0) {
        if (!project.nextSteps) return null;
        const { nextSteps: _drop, ...rest } = project;
        return rest as WorkProject;
      }
      return { ...project, nextSteps: cleaned };
    });
  }

  clearNextSteps(projectId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      if (!project.nextSteps) return null;
      const { nextSteps: _drop, ...rest } = project;
      return rest as WorkProject;
    });
  }

  clearPendingPrompt(projectId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      if (!project.pendingPrompt) return null;
      const { pendingPrompt: _drop, ...rest } = project;
      return rest as WorkProject;
    });
  }

  /** Legacy hard-delete entry point (kept for compatibility with the tRPC
   *  `delete` mutation, which routes through `commitDelete` now). */
  delete(projectId: string): void {
    this.commitDelete(projectId);
  }

  addTile(
    projectId: string,
    input: NewTileInput,
    options: { state?: Tile["state"]; origin?: Tile["origin"] } = {},
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tile: Tile = {
        ...input,
        id: newId("tile"),
        size: input.size ?? defaultSizeFor(input.type),
        state: options.state ?? "live",
        origin: options.origin ?? "user",
      } as Tile;
      return { ...project, tiles: [...project.tiles, tile] };
    });
  }

  removeTile(projectId: string, tileId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.filter((t) => t.id !== tileId);
      if (tiles.length === project.tiles.length) return null;
      return { ...project, tiles };
    });
  }

  updateTileSize(
    projectId: string,
    tileId: string,
    size: TileSize,
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) =>
        t.id === tileId ? ({ ...t, size } as Tile) : t,
      );
      return { ...project, tiles };
    });
  }

  moveTile(
    projectId: string,
    tileId: string,
    toIndex: number,
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const fromIndex = project.tiles.findIndex((t) => t.id === tileId);
      if (fromIndex < 0) return null;
      const clampedIndex = Math.max(
        0,
        Math.min(toIndex, project.tiles.length - 1),
      );
      if (fromIndex === clampedIndex) return null;
      const tiles = project.tiles.slice();
      const [moved] = tiles.splice(fromIndex, 1);
      tiles.splice(clampedIndex, 0, moved);
      return { ...project, tiles };
    });
  }

  /** Batch-update many tiles' positions and sizes. Used by the canvas grid
   *  after a drag/resize so all neighbors that the compactor shifted around
   *  get persisted in one write. Items not in the payload are left alone. */
  updateTileLayout(
    projectId: string,
    items: Array<{
      tileId: string;
      cols: number;
      rows: number;
      x: number;
      y: number;
    }>,
  ): WorkProject | null {
    if (items.length === 0) return this.get(projectId);
    const byId = new Map(items.map((it) => [it.tileId, it]));
    return this.mutateProject(projectId, (project) => {
      let mutated = false;
      const tiles = project.tiles.map((t) => {
        const it = byId.get(t.id);
        if (!it) return t;
        const cols = Math.max(1, Math.min(12, Math.round(it.cols)));
        const rows = Math.max(1, Math.min(4, Math.round(it.rows)));
        const x = Math.max(0, Math.min(11, Math.round(it.x)));
        const y = Math.max(0, Math.round(it.y));
        const prevSize = t.gridSize;
        const prevPos = t.gridPosition;
        if (
          prevSize?.cols === cols &&
          prevSize?.rows === rows &&
          prevPos?.x === x &&
          prevPos?.y === y
        ) {
          return t;
        }
        mutated = true;
        return {
          ...t,
          gridSize: { cols, rows },
          gridPosition: { x, y },
        } as typeof t;
      });
      if (!mutated) return null;
      return { ...project, tiles };
    });
  }

  updateTitleTile(
    projectId: string,
    patch: { name?: string; tagline?: string; iconId?: WorkProject["iconId"] },
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      let mutated = false;
      const tiles = project.tiles.map((t) => {
        if (t.type !== "title") return t;
        mutated = true;
        const next = { ...t };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.tagline !== undefined) next.tagline = patch.tagline;
        if (patch.iconId !== undefined) next.iconId = patch.iconId;
        return next;
      });
      if (!mutated) return null;
      const projectPatch: Partial<WorkProject> = {};
      if (patch.name !== undefined) projectPatch.name = patch.name;
      if (patch.tagline !== undefined) projectPatch.tagline = patch.tagline;
      if (patch.iconId !== undefined) projectPatch.iconId = patch.iconId;
      return { ...project, ...projectPatch, tiles };
    });
  }

  updateNoteTile(
    projectId: string,
    tileId: string,
    patch: {
      body?: string;
      tone?: "yellow" | "blue" | "green" | "pink" | "neutral";
    },
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) => {
        if (t.id !== tileId || t.type !== "note") return t;
        return {
          ...t,
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
        };
      });
      return { ...project, tiles };
    });
  }

  updateTileGridSize(
    projectId: string,
    tileId: string,
    gridSize: GridSize,
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) =>
        t.id === tileId ? ({ ...t, gridSize } as Tile) : t,
      );
      return { ...project, tiles };
    });
  }

  /** Replace the checklist items on an artifact tile of kind "checklist".
   *  No-ops on the wrong tile type / wrong kind. */
  updateChecklistTile(
    projectId: string,
    tileId: string,
    items: Array<{ text: string; done: boolean }>,
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) => {
        if (t.id !== tileId) return t;
        if (t.type !== "artifact" || t.kind !== "checklist") return t;
        return { ...t, data: { ...t.data, items } } as Tile;
      });
      return { ...project, tiles };
    });
  }

  updateFileTile(
    projectId: string,
    tileId: string,
    patch: {
      title?: string;
      items?: Array<{ path: string; addedAt: string }>;
    },
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) => {
        if (t.id !== tileId || t.type !== "file") return t;
        return {
          ...t,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.items !== undefined ? { items: patch.items } : {}),
        };
      });
      return { ...project, tiles };
    });
  }

  updateHeadlineTile(
    projectId: string,
    tileId: string,
    patch: HeadlineTilePatch,
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) => {
        if (t.id !== tileId || t.type !== "headline") return t;
        return {
          ...t,
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.liveLabel !== undefined
            ? { liveLabel: patch.liveLabel }
            : {}),
          ...(patch.query !== undefined ? { query: patch.query } : {}),
          ...(patch.posthogUrl !== undefined
            ? { posthogUrl: patch.posthogUrl }
            : {}),
          ...(patch.fallbackValue !== undefined
            ? { fallbackValue: patch.fallbackValue }
            : {}),
          ...(patch.fallbackDelta !== undefined
            ? { fallbackDelta: patch.fallbackDelta }
            : {}),
          ...(patch.fallbackSparkline !== undefined
            ? { fallbackSparkline: patch.fallbackSparkline }
            : {}),
        };
      });
      return { ...project, tiles };
    });
  }

  /** Clear the live insight on a headline tile (re-opens the picker in the
   *  renderer). Separate from `updateHeadlineTile` because that patch shape
   *  can't express "delete a key". */
  clearHeadlineTileQuery(
    projectId: string,
    tileId: string,
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) => {
        if (t.id !== tileId || t.type !== "headline") return t;
        const { query: _q, posthogUrl: _u, liveLabel: _l, ...rest } = t;
        return rest as Tile;
      });
      return { ...project, tiles };
    });
  }

  updateGithubActivityTile(
    projectId: string,
    tileId: string,
    patch: {
      repo?: { owner: string; name: string };
      enabledTypes?: GithubActivityType[];
      windowDays?: number;
      summary?: GithubActivitySummary;
    },
  ): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tiles = project.tiles.map((t) => {
        if (t.id !== tileId || t.type !== "github_activity") return t;
        return {
          ...t,
          ...(patch.repo !== undefined ? { repo: patch.repo } : {}),
          ...(patch.enabledTypes !== undefined
            ? { enabledTypes: patch.enabledTypes }
            : {}),
          ...(patch.windowDays !== undefined
            ? { windowDays: patch.windowDays }
            : {}),
          ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        };
      });
      return { ...project, tiles };
    });
  }

  /** Read helper for the github_activity tile, used by the refresh path so the
   *  service that does the gh fetch can look up the tile's config. */
  getGithubActivityTileConfig(
    projectId: string,
    tileId: string,
  ): {
    repo: { owner: string; name: string };
    enabledTypes: GithubActivityType[];
    windowDays: number;
  } | null {
    const project = this.get(projectId);
    if (!project) return null;
    const tile = project.tiles.find((t) => t.id === tileId);
    if (!tile || tile.type !== "github_activity" || !tile.repo) return null;
    return {
      repo: tile.repo,
      enabledTypes: tile.enabledTypes,
      windowDays: tile.windowDays,
    };
  }

  applyPending(projectId: string, tileId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tile = project.tiles.find((t) => t.id === tileId);
      if (!tile) return null;
      if (tile.state === "pending_remove") {
        return {
          ...project,
          tiles: project.tiles.filter((t) => t.id !== tileId),
        };
      }
      if (tile.state === "pending_add" || tile.state === "pending_edit") {
        return {
          ...project,
          tiles: project.tiles.map((t) =>
            t.id === tileId ? ({ ...t, state: "live" } as Tile) : t,
          ),
        };
      }
      return null;
    });
  }

  rejectPending(projectId: string, tileId: string): WorkProject | null {
    return this.mutateProject(projectId, (project) => {
      const tile = project.tiles.find((t) => t.id === tileId);
      if (!tile) return null;
      if (tile.state === "pending_add") {
        return {
          ...project,
          tiles: project.tiles.filter((t) => t.id !== tileId),
        };
      }
      if (tile.state === "pending_remove" || tile.state === "pending_edit") {
        return {
          ...project,
          tiles: project.tiles.map((t) =>
            t.id === tileId ? ({ ...t, state: "live" } as Tile) : t,
          ),
        };
      }
      return null;
    });
  }

  /** Test-only helper. */
  resetForTest(): void {
    this.store.clear();
    this.ensureSeeded();
  }
}
