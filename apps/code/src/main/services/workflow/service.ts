import {
  type SaveInput,
  type SaveResult,
  type WorkflowConfig,
  WorkflowEvent,
  type WorkflowEvents,
} from "@shared/types/workflow";
import { validateWorkflow } from "@shared/types/workflow-validate";
import { inject, injectable, postConstruct } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { WorkflowBackend } from "./backend";
import { buildDefaultWorkflow } from "./default-workflow";

const WORKFLOW_ID = "default";
const log = logger.scope("workflow");

/**
 * Owns the workflow lifecycle (load → seed default → save → emit
 * `WorkflowChanged`). Storage details live behind {@link WorkflowBackend}
 * so this service is the same code whether persistence is local SQLite
 * or a remote PostHog API — see `docs/workflow-architecture.md`.
 */
@injectable()
export class WorkflowService extends TypedEventEmitter<WorkflowEvents> {
  private cached: WorkflowConfig | null = null;
  private inflightLoad: Promise<WorkflowConfig> | null = null;

  constructor(
    @inject(MAIN_TOKENS.WorkflowBackend)
    private readonly backend: WorkflowBackend,
  ) {
    super();
  }

  @postConstruct()
  init(): void {
    void this.get();
  }

  async get(): Promise<WorkflowConfig> {
    if (this.cached) return this.cached;
    // Dedup concurrent first-load callers behind one in-flight promise.
    if (this.inflightLoad) return this.inflightLoad;
    this.inflightLoad = this.loadOrSeed().finally(() => {
      this.inflightLoad = null;
    });
    return this.inflightLoad;
  }

  async save(input: SaveInput): Promise<SaveResult> {
    const current = await this.get();
    if (current.version !== input.expectedVersion) {
      return { status: "conflict", config: current };
    }
    const validation = validateWorkflow(input.config);
    if (!validation.canSave) {
      return {
        status: "invalid",
        config: current,
        diagnostics: validation.diagnostics,
      };
    }
    const next: WorkflowConfig = {
      ...input.config,
      id: WORKFLOW_ID,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.backend.save(next);
    this.cached = next;
    this.emit(WorkflowEvent.Changed, next);
    log.info("Workflow saved", {
      version: next.version,
      actionCount: Object.values(next.bindings).reduce(
        (sum, list) => sum + list.length,
        0,
      ),
    });
    return { status: "saved", config: next };
  }

  async resetToDefault(): Promise<WorkflowConfig> {
    const current = await this.get();
    const fresh = buildDefaultWorkflow();
    const next: WorkflowConfig = {
      ...fresh,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.backend.save(next);
    this.cached = next;
    this.emit(WorkflowEvent.Changed, next);
    log.info("Workflow reset to default", { version: next.version });
    return next;
  }

  private async loadOrSeed(): Promise<WorkflowConfig> {
    const loaded = await this.backend.load();
    if (loaded) {
      this.cached = loaded;
      return loaded;
    }
    const seed = buildDefaultWorkflow();
    await this.backend.save(seed);
    this.cached = seed;
    log.info("Seeded default workflow", { version: seed.version });
    return seed;
  }
}
