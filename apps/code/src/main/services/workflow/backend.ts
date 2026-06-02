import type { HomeWorkflowRepository } from "@main/db/repositories/home-workflow-repository";
import { MAIN_TOKENS } from "@main/di/tokens";
import { logger } from "@main/utils/logger";
import { type WorkflowConfig, workflowConfig } from "@shared/types/workflow";
import { inject, injectable } from "inversify";

const log = logger.scope("workflow-backend");

/**
 * Single seam between `WorkflowService` and where the workflow config lives.
 * Today local SQLite ({@link LocalWorkflowBackend}); a `CloudWorkflowBackend`
 * replaces the binding for cross-device storage (docs/workflow-architecture.md).
 *
 * Implementations: `version` is monotonic (only `save` bumps it); `load()`
 * returns `null` rather than throwing, validates against `workflowConfig`, and
 * drops bad rows on read so the service reseeds; `delete()` is idempotent.
 */
export interface WorkflowBackend {
  load(): Promise<WorkflowConfig | null>;
  save(config: WorkflowConfig): Promise<void>;
  delete(): Promise<void>;
}

const WORKFLOW_ID = "default";

@injectable()
export class LocalWorkflowBackend implements WorkflowBackend {
  constructor(
    @inject(MAIN_TOKENS.HomeWorkflowRepository)
    private readonly repository: HomeWorkflowRepository,
  ) {}

  async load(): Promise<WorkflowConfig | null> {
    const row = this.repository.findById(WORKFLOW_ID);
    if (!row) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(row.json);
    } catch (err) {
      log.warn("Persisted workflow JSON is corrupt — dropping row", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.repository.delete(WORKFLOW_ID);
      return null;
    }

    // Authoritative `version` + `updatedAt` come from the row, not the JSON
    // body, so a stale blob field can't shadow the monotonic counter.
    const parsed = workflowConfig.safeParse({
      ...(typeof raw === "object" && raw !== null ? raw : {}),
      version: row.version,
      updatedAt: row.updatedAt,
    });
    if (!parsed.success) {
      log.warn("Persisted workflow no longer matches schema — dropping row", {
        error: parsed.error.message,
      });
      this.repository.delete(WORKFLOW_ID);
      return null;
    }
    return parsed.data;
  }

  async save(config: WorkflowConfig): Promise<void> {
    this.repository.upsert({
      id: WORKFLOW_ID,
      version: config.version,
      json: JSON.stringify(config),
      updatedAt: config.updatedAt,
    });
  }

  async delete(): Promise<void> {
    this.repository.delete(WORKFLOW_ID);
  }
}
