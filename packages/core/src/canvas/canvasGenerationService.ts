import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import type { AuthState } from "@posthog/core/auth/schemas";
import type { ReportModelResolver } from "@posthog/core/inbox/identifiers";
import { REPORT_MODEL_RESOLVER } from "@posthog/core/inbox/identifiers";
import { TITLE_GENERATOR_SERVICE } from "@posthog/core/sessions/titleGeneratorIdentifiers";
import type { TitleGeneratorService } from "@posthog/core/sessions/titleGeneratorService";
import type { TaskService } from "@posthog/core/task-detail/taskService";
import { TASK_SERVICE } from "@posthog/core/task-detail/taskService";
import {
  type Adapter,
  getCloudUrlFromRegion,
  type WorkspaceMode,
} from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { inject, injectable } from "inversify";
import { buildFreeformGenerationPrompt } from "./canvasGenerationPrompt";
import { CHANNEL_TASKS_SERVICE, DASHBOARDS_SERVICE } from "./identifiers";
import type { IChannelTasksService, IDashboardsService } from "./services";

export const CANVAS_GENERATION_SERVICE = Symbol.for(
  "posthog.core.canvas.generationService",
);

interface CanvasGenerationAuth {
  getState(): Pick<AuthState, "cloudRegion">;
}

export interface GenerateCanvasInput {
  dashboardId: string;
  channelId: string;
  channelName: string;
  name: string;
  instruction: string;
  templateId?: string;
  currentCode?: string;
  backendChannelId?: string;
  channelContext?: string;
  adapter?: Adapter;
  model?: string;
  reasoningLevel?: string;
  useStarter?: boolean;
  workspaceMode?: WorkspaceMode;
}

export type GenerateCanvasResult =
  | { success: true; taskId: string; taskRunId: string | null; task: Task }
  | { success: false; error: string };

export function isPlaceholderCanvasName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "Untitled canvas" || trimmed === "Untitled dashboard";
}

@injectable()
export class CanvasGenerationService {
  constructor(
    @inject(TASK_SERVICE) private readonly taskService: TaskService,
    @inject(REPORT_MODEL_RESOLVER)
    private readonly modelResolver: ReportModelResolver,
    @inject(AUTH_SERVICE) private readonly auth: CanvasGenerationAuth,
    @inject(CHANNEL_TASKS_SERVICE)
    private readonly channelTasks: Pick<IChannelTasksService, "file">,
    @inject(DASHBOARDS_SERVICE)
    private readonly dashboards: Pick<
      IDashboardsService,
      "setGenerationTask" | "rename"
    >,
    @inject(TITLE_GENERATOR_SERVICE)
    private readonly titleGenerator: Pick<
      TitleGeneratorService,
      "generateCanvasName"
    >,
  ) {}

  async generate(input: GenerateCanvasInput): Promise<GenerateCanvasResult> {
    const workspaceMode = input.workspaceMode ?? "cloud";
    const adapter = input.adapter ?? "claude";
    let model = input.model;

    if (workspaceMode === "cloud") {
      const region = this.auth.getState().cloudRegion;
      model = region
        ? await this.modelResolver.resolveDefaultModel(
            getCloudUrlFromRegion(region),
            adapter,
            input.model,
          )
        : undefined;
      if (!model) {
        return {
          success: false,
          error: "No model is configured for cloud runs.",
        };
      }
    }

    const result = await this.taskService.createTask(
      {
        content: buildFreeformGenerationPrompt(input),
        taskDescription: `Generate canvas "${input.name}"`,
        executionMode: "auto",
        workspaceMode,
        adapter,
        model,
        reasoningLevel: input.reasoningLevel,
        allowNoRepo: true,
        channelContext: input.channelContext,
        channelName: input.channelName,
        channelId: input.backendChannelId,
      },
      undefined,
    );
    if (!result.success) return { success: false, error: result.error };

    const task = result.data.task;
    await Promise.allSettled([
      this.channelTasks.file({
        channelId: input.channelId,
        taskId: task.id,
        taskTitle: task.title,
      }),
      this.dashboards.setGenerationTask({
        id: input.dashboardId,
        taskId: task.id,
      }),
    ]);

    if (isPlaceholderCanvasName(input.name)) {
      void this.titleGenerator
        .generateCanvasName(input.instruction)
        .then((generated) => {
          const name = generated?.trim();
          return name
            ? this.dashboards.rename({ id: input.dashboardId, name })
            : undefined;
        })
        .catch(() => undefined);
    }

    return {
      success: true,
      taskId: task.id,
      taskRunId: task.latest_run?.id ?? null,
      task,
    };
  }
}
