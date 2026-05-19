import { eq, isNotNull } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { workspaces } from "../schema";
import type { DatabaseService } from "../service";

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMode = "cloud" | "local" | "worktree";

export interface CreateWorkspaceData {
  taskId: string;
  repositoryId: string | null;
  mode: WorkspaceMode;
}

export interface IWorkspaceRepository {
  findById(id: string): Workspace | null;
  findByTaskId(taskId: string): Workspace | null;
  findAllByRepositoryId(repositoryId: string): Workspace[];
  findAllPinned(): Workspace[];
  findAll(): Workspace[];
  create(data: CreateWorkspaceData): Workspace;
  deleteByTaskId(taskId: string): void;
  deleteById(id: string): void;
  updatePinnedAt(taskId: string, pinnedAt: string | null): void;
  updateLastViewedAt(taskId: string, lastViewedAt: string): void;
  updateLastActivityAt(taskId: string, lastActivityAt: string): void;
  updateLinkedBranch(taskId: string, linkedBranch: string | null): void;
  updateMode(taskId: string, mode: WorkspaceMode): void;
  setModeAndRepository(
    taskId: string,
    mode: WorkspaceMode,
    repositoryId: string | null,
  ): void;
  deleteAll(): void;
}

const byId = (id: string) => eq(workspaces.id, id);
const byTaskId = (taskId: string) => eq(workspaces.taskId, taskId);
const byRepositoryId = (repoId: string) => eq(workspaces.repositoryId, repoId);
const isPinned = isNotNull(workspaces.pinnedAt);
const now = () => new Date().toISOString();

@injectable()
export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findById(id: string): Workspace | null {
    return this.db.select().from(workspaces).where(byId(id)).get() ?? null;
  }

  findByTaskId(taskId: string): Workspace | null {
    return (
      this.db.select().from(workspaces).where(byTaskId(taskId)).get() ?? null
    );
  }

  findAllByRepositoryId(repositoryId: string): Workspace[] {
    return this.db
      .select()
      .from(workspaces)
      .where(byRepositoryId(repositoryId))
      .all();
  }

  findAllPinned(): Workspace[] {
    return this.db.select().from(workspaces).where(isPinned).all();
  }

  findAll(): Workspace[] {
    return this.db.select().from(workspaces).all();
  }

  create(data: CreateWorkspaceData): Workspace {
    const timestamp = now();
    const id = crypto.randomUUID();
    const row: NewWorkspace = {
      id,
      taskId: data.taskId,
      repositoryId: data.repositoryId,
      mode: data.mode,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(workspaces).values(row).run();
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to create workspace with id ${id}`);
    }
    return created;
  }

  deleteByTaskId(taskId: string): void {
    this.db.delete(workspaces).where(byTaskId(taskId)).run();
  }

  deleteById(id: string): void {
    this.db.delete(workspaces).where(byId(id)).run();
  }

  updatePinnedAt(taskId: string, pinnedAt: string | null): void {
    this.db
      .update(workspaces)
      .set({ pinnedAt, updatedAt: now() })
      .where(byTaskId(taskId))
      .run();
  }

  updateLastViewedAt(taskId: string, lastViewedAt: string): void {
    this.db
      .update(workspaces)
      .set({ lastViewedAt, updatedAt: now() })
      .where(byTaskId(taskId))
      .run();
  }

  updateLastActivityAt(taskId: string, lastActivityAt: string): void {
    this.db
      .update(workspaces)
      .set({ lastActivityAt, updatedAt: now() })
      .where(byTaskId(taskId))
      .run();
  }

  updateLinkedBranch(taskId: string, linkedBranch: string | null): void {
    this.db
      .update(workspaces)
      .set({ linkedBranch, updatedAt: now() })
      .where(byTaskId(taskId))
      .run();
  }

  updateMode(taskId: string, mode: WorkspaceMode): void {
    this.db
      .update(workspaces)
      .set({ mode, updatedAt: now() })
      .where(byTaskId(taskId))
      .run();
  }

  setModeAndRepository(
    taskId: string,
    mode: WorkspaceMode,
    repositoryId: string | null,
  ): void {
    this.db
      .update(workspaces)
      .set({ mode, repositoryId, updatedAt: now() })
      .where(byTaskId(taskId))
      .run();
  }

  deleteAll(): void {
    this.db.delete(workspaces).run();
  }
}
