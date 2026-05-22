import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  conversationTurnsToJsonlEntries,
  filterEntriesUpToMessage,
  getSessionJsonlPath,
  rebuildConversation,
  selectRecentTurns,
} from "@posthog/agent/adapters/claude/session/jsonl-hydration";
import { PostHogAPIClient } from "@posthog/agent/posthog-api";
import type * as AgentTypes from "@posthog/agent/types";
import { createGitClient } from "@posthog/git/client";
import { inject, injectable } from "inversify";
import { v7 as uuidv7 } from "uuid";
import type { ForkRelationshipRepository } from "../../db/repositories/fork-relationship-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AgentAuthAdapter } from "../agent/auth-adapter";
import type { WorkspaceService } from "../workspace/service";

const log = logger.scope("fork-service");

export interface PrepareForkInput {
  sourceTaskId: string;
  sourceTaskRunId: string;
  /** Title of the source task — stored so we can show it even if the task is later deleted. */
  sourceTaskTitle: string;
  forkAtMessageIndex: number;
  newTaskId: string;
  newTaskRunId: string;
  sourceWorktreePath: string;
  mainRepoPath: string;
  apiHost: string;
  projectId: number;
  model?: string;
}

export interface PrepareForkResult {
  newWorktreePath: string;
  newSessionId: string;
}

@injectable()
export class ForkService {
  constructor(
    @inject(MAIN_TOKENS.AgentAuthAdapter)
    private readonly agentAuthAdapter: AgentAuthAdapter,
    @inject(MAIN_TOKENS.WorkspaceService)
    private readonly workspaceService: WorkspaceService,
    @inject(MAIN_TOKENS.ForkRelationshipRepository)
    private readonly forkRepo: ForkRelationshipRepository,
  ) {}

  async prepareFork(input: PrepareForkInput): Promise<PrepareForkResult> {
    const {
      sourceTaskId,
      sourceTaskRunId,
      sourceTaskTitle,
      forkAtMessageIndex,
      newTaskId,
      newTaskRunId,
      sourceWorktreePath,
      mainRepoPath,
      apiHost,
      projectId,
      model,
    } = input;

    log.info("Preparing fork", {
      sourceTaskId,
      sourceTaskRunId,
      forkAtMessageIndex,
      newTaskId,
    });

    const posthogConfig = this.agentAuthAdapter.createPosthogConfig({
      apiHost,
      projectId,
    });
    const posthogAPI = new PostHogAPIClient(posthogConfig);

    // 1. Fetch the full S3 log for the source run
    const sourceTaskRun = await posthogAPI.getTaskRun(
      sourceTaskId,
      sourceTaskRunId,
    );
    const allEntries = await posthogAPI.fetchTaskRunLogs(sourceTaskRun);

    // 2. Slice entries up to and including the response to message N
    const entries = filterEntriesUpToMessage(allEntries, forkAtMessageIndex);

    // 3. Find git HEAD SHA from the last checkpoint entry in the filtered set
    const headSha =
      this.extractHeadSha(entries) ??
      (await this.getCurrentHead(sourceWorktreePath));

    if (!headSha) {
      throw new Error(
        `Cannot determine git HEAD for fork at message ${forkAtMessageIndex} (sourceTaskRunId: ${sourceTaskRunId})`,
      );
    }

    // 4. Create the new worktree + workspace record
    const workspace = await this.workspaceService.createWorkspaceFromFork({
      taskId: newTaskId,
      mainRepoPath,
      headSha,
    });

    // 5. Record the lineage so the UI can show "Forked from: [title]"
    this.forkRepo.create({
      forkedTaskId: newTaskId,
      sourceTaskId,
      sourceTaskRunId,
      sourceTaskTitle,
      forkAtMessageIndex,
      forkedAt: new Date().toISOString(),
    });

    const newWorktreePath = workspace.worktree?.worktreePath;
    if (!newWorktreePath) {
      throw new Error(`Fork workspace creation did not return a worktree path`);
    }

    // 6. Write the truncated conversation as a JSONL file for the new SDK session
    const newSessionId = uuidv7();
    await this.writeSessionJsonl({
      entries,
      sessionId: newSessionId,
      cwd: newWorktreePath,
      model,
    });

    // 7. Write truncated log to local cache so the new run can be resumed instantly
    await this.writeLocalCache(newTaskRunId, entries);

    log.info("Fork prepared", {
      newTaskId,
      newTaskRunId,
      newWorktreePath,
      newSessionId,
      headSha,
      entriesIncluded: entries.length,
    });

    return { newWorktreePath, newSessionId };
  }

  /** Extract the HEAD SHA from the last `_posthog/agent_checkpoint` entry. */
  private extractHeadSha(entries: AgentTypes.StoredEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.notification?.method === "_posthog/agent_checkpoint") {
        const headSha = (entry.notification.params as Record<string, unknown>)
          ?.headSha;
        if (typeof headSha === "string" && headSha.trim()) {
          return headSha.trim();
        }
      }
    }
    return null;
  }

  /** Fallback: get the current HEAD SHA from the source worktree on disk. */
  private async getCurrentHead(worktreePath: string): Promise<string | null> {
    try {
      const git = createGitClient(worktreePath);
      return await git.revparse(["HEAD"]);
    } catch {
      return null;
    }
  }

  private async writeSessionJsonl(params: {
    entries: AgentTypes.StoredEntry[];
    sessionId: string;
    cwd: string;
    model?: string;
  }): Promise<void> {
    const { entries, sessionId, cwd, model } = params;

    const allTurns = rebuildConversation(entries);
    if (allTurns.length === 0) return;

    const turns = selectRecentTurns(allTurns);
    const lines = conversationTurnsToJsonlEntries(turns, {
      sessionId,
      cwd,
      model,
    });

    const jsonlPath = getSessionJsonlPath(sessionId, cwd);
    await fs.mkdir(path.dirname(jsonlPath), { recursive: true });

    const tmpPath = `${jsonlPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, `${lines.join("\n")}\n`);
    await fs.rename(tmpPath, jsonlPath);

    log.info("Wrote fork JSONL", { sessionId, turns: turns.length });
  }

  private async writeLocalCache(
    taskRunId: string,
    entries: AgentTypes.StoredEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const sessionDir = path.join(
      homedir(),
      ".posthog-code",
      "sessions",
      taskRunId,
    );
    const logPath = path.join(sessionDir, "logs.ndjson");

    await fs.mkdir(sessionDir, { recursive: true });
    const lines = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
    await fs.writeFile(logPath, lines, "utf-8");

    log.info("Wrote fork local cache", { taskRunId, entries: entries.length });
  }
}
