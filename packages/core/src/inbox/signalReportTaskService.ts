import {
  type CloudRegion,
  getCloudUrlFromRegion,
  type TaskCreationOutput,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import {
  type CreateTaskResult,
  TASK_SERVICE,
  type TaskService,
} from "../task-detail/taskService";
import { REPORT_MODEL_RESOLVER, type ReportModelResolver } from "./identifiers";
import {
  buildCreatePrReportPrompt,
  buildDiscussReportPrompt,
} from "./reportActions";
import { buildSignalReportTaskInput } from "./reportTaskCreation";

export type SignalReportTaskKind = "discuss" | "create-pr";

export interface CreateSignalReportTaskInput {
  kind: SignalReportTaskKind;
  reportId: string;
  reportTitle: string | null;
  cloudRepository: string | null;
  githubUserIntegrationId: string | null;
  cloudRegion: CloudRegion | null;
  adapter: "claude" | "codex";
  modelOverride?: string | null;
  reasoningLevel?: string;
  question?: string;
  feedback?: string;
  baseBranch?: string | null;
  isDevBuild: boolean;
}

export type CreateSignalReportTaskResult =
  | { status: "missing-repository" }
  | { status: "missing-integration" }
  | { status: "not-authenticated" }
  | { status: "missing-model" }
  | { status: "created" }
  | { status: "create-failed"; error?: string; failedStep?: string }
  | { status: "errored"; error: string };

@injectable()
export class SignalReportTaskService {
  constructor(
    @inject(TASK_SERVICE) private readonly taskService: TaskService,
    @inject(REPORT_MODEL_RESOLVER)
    private readonly modelResolver: ReportModelResolver,
  ) {}

  async createSignalReportTask(
    input: CreateSignalReportTaskInput,
    onTaskReady: (output: TaskCreationOutput) => void,
  ): Promise<CreateSignalReportTaskResult> {
    if (!input.cloudRepository) {
      return { status: "missing-repository" };
    }
    if (!input.githubUserIntegrationId) {
      return { status: "missing-integration" };
    }
    if (!input.cloudRegion) {
      return { status: "not-authenticated" };
    }

    const apiHost = getCloudUrlFromRegion(input.cloudRegion);
    // The override is a preference: the resolver keeps it only if the gateway
    // still offers it, otherwise it falls back to the server default. On a
    // transient resolver failure (undefined) we fall back to the explicit
    // override so a valid override-driven run isn't blocked by a gateway outage.
    const resolvedModel = await this.modelResolver.resolveDefaultModel(
      apiHost,
      input.adapter,
      input.modelOverride,
    );
    const model = resolvedModel ?? input.modelOverride;
    if (!model) {
      return { status: "missing-model" };
    }

    const prompt =
      input.kind === "discuss"
        ? buildDiscussReportPrompt({
            reportId: input.reportId,
            reportTitle: input.reportTitle,
            question: input.question,
            isDevBuild: input.isDevBuild,
          })
        : buildCreatePrReportPrompt({
            reportId: input.reportId,
            isDevBuild: input.isDevBuild,
            feedback: input.feedback,
          });

    const taskInput = buildSignalReportTaskInput({
      prompt,
      reportId: input.reportId,
      cloudRepository: input.cloudRepository,
      githubUserIntegrationId: input.githubUserIntegrationId,
      adapter: input.adapter,
      model,
      reasoningLevel: input.reasoningLevel,
      baseBranch: input.baseBranch,
    });

    let result: CreateTaskResult;
    try {
      result = await this.taskService.createTask(taskInput, onTaskReady);
    } catch (error) {
      return {
        status: "errored",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    if (result.success) {
      return { status: "created" };
    }
    return {
      status: "create-failed",
      error: result.error,
      failedStep: result.failedStep,
    };
  }
}
