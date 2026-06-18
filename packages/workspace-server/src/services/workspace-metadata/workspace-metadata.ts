import { inject, injectable } from "inversify";
import { WORKSPACE_REPOSITORY } from "../../db/identifiers";
import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";

export interface TaskTimestamps {
  pinnedAt: string | null;
  lastViewedAt: string | null;
  lastActivityAt: string | null;
}

/**
 * Pin / view / activity metadata for tasks — pure projections over the
 * Workspace records. Extracted from the monolithic WorkspaceService so these
 * data operations live next to the repository, with no git/fs/orchestration.
 */
@injectable()
export class WorkspaceMetadataService {
  constructor(
    @inject(WORKSPACE_REPOSITORY)
    private readonly workspaceRepo: IWorkspaceRepository,
  ) {}

  togglePin(taskId: string): { isPinned: boolean; pinnedAt: string | null } {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) {
      return { isPinned: false, pinnedAt: null };
    }
    const newPinnedAt = workspace.pinnedAt ? null : new Date().toISOString();
    this.workspaceRepo.updatePinnedAt(taskId, newPinnedAt);
    return { isPinned: newPinnedAt !== null, pinnedAt: newPinnedAt };
  }

  markViewed(taskId: string): void {
    this.workspaceRepo.updateLastViewedAt(taskId, new Date().toISOString());
  }

  markActivity(taskId: string): void {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    const lastViewedAt = workspace?.lastViewedAt
      ? new Date(workspace.lastViewedAt).getTime()
      : 0;
    const now = Date.now();
    const activityTime = Math.max(now, lastViewedAt + 1);
    this.workspaceRepo.updateLastActivityAt(
      taskId,
      new Date(activityTime).toISOString(),
    );
  }

  getPinnedTaskIds(): string[] {
    return this.workspaceRepo.findAllPinned().map((w) => w.taskId);
  }

  getTaskTimestamps(taskId: string): TaskTimestamps {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    return {
      pinnedAt: workspace?.pinnedAt ?? null,
      lastViewedAt: workspace?.lastViewedAt ?? null,
      lastActivityAt: workspace?.lastActivityAt ?? null,
    };
  }

  getAllTaskTimestamps(): Record<string, TaskTimestamps> {
    const result: Record<string, TaskTimestamps> = {};
    for (const w of this.workspaceRepo.findAll()) {
      result[w.taskId] = {
        pinnedAt: w.pinnedAt,
        lastViewedAt: w.lastViewedAt,
        lastActivityAt: w.lastActivityAt,
      };
    }
    return result;
  }
}
