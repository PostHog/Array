import {
  type SaveInput,
  type SaveResult,
  saveResult,
  type WorkflowConfig,
  WorkflowEvent,
  type WorkflowEvents,
  workflowConfig,
} from "@shared/types/workflow";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { AuthService } from "../auth/service";

const log = logger.scope("workflow");

/**
 * Reads and writes the user's Home workflow config from PostHog
 * (`/api/projects/:id/code_workflow/`). The server owns persistence, the
 * monotonic `version`, optimistic concurrency, validation, and the default
 * seed; this service is a thin authenticated client that emits
 * {@link WorkflowEvent.Changed} on save/reset.
 */
@injectable()
export class WorkflowService extends TypedEventEmitter<WorkflowEvents> {
  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {
    super();
  }

  async get(): Promise<WorkflowConfig> {
    const json = await this.request("GET", "code_workflow/");
    return workflowConfig.parse(json);
  }

  async save(input: SaveInput): Promise<SaveResult> {
    const json = await this.request("POST", "code_workflow/save/", {
      config: input.config,
      expectedVersion: input.expectedVersion,
    });
    const parsed = saveResult.parse(json);
    if (parsed.status === "saved") {
      this.emit(WorkflowEvent.Changed, parsed.config);
      log.info("Workflow saved", { version: parsed.config.version });
    }
    return parsed;
  }

  async resetToDefault(): Promise<WorkflowConfig> {
    const json = await this.request("POST", "code_workflow/reset/");
    const config = workflowConfig.parse(json);
    this.emit(WorkflowEvent.Changed, config);
    log.info("Workflow reset to default", { version: config.version });
    return config;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await this.authService.authenticatedProjectFetch(path, init);
    // 409/422 carry a structured SaveResult body the caller validates.
    if (!res.ok && res.status !== 409 && res.status !== 422) {
      throw new Error(`Workflow request failed: ${res.status}`);
    }
    return res.json();
  }
}
