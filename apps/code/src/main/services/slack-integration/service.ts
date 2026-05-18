import type { IMainWindow } from "@posthog/platform/main-window";
import type { IUrlLauncher } from "@posthog/platform/url-launcher";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { DeepLinkService } from "../deep-link/service";
import type { CloudRegion, StartSlackFlowOutput } from "./schemas";

const log = logger.scope("slack-integration-service");

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export const SlackIntegrationEvent = {
  Callback: "callback",
  FlowTimedOut: "flowTimedOut",
} as const;

export interface SlackIntegrationCallback {
  projectId: number | null;
  integrationId: number | null;
  status: "success" | "error";
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SlackFlowTimedOut {
  projectId: number;
}

export interface SlackIntegrationEvents {
  [SlackIntegrationEvent.Callback]: SlackIntegrationCallback;
  [SlackIntegrationEvent.FlowTimedOut]: SlackFlowTimedOut;
}

/**
 * Drives the in-app "Connect Slack" flow:
 *   1. The renderer asks for `startFlow(region, projectId)`, which opens the user's
 *      default browser at PostHog Cloud's Slack OAuth authorize endpoint.
 *   2. PostHog Cloud completes Slack OAuth, creates the team-level Slack `Integration`
 *      row, and redirects to `/account-connected/slack-integration?integration_id=…`,
 *      which sends a `posthog-code://slack-integration?…` deep link.
 *   3. The deep-link handler emits a `Callback` event; renderers refresh integrations.
 *
 * Mirrors `GitHubIntegrationService` so each provider's deep-link handler is independent.
 */
@injectable()
export class SlackIntegrationService extends TypedEventEmitter<SlackIntegrationEvents> {
  private pendingCallback: SlackIntegrationCallback | null = null;
  private flowTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @inject(MAIN_TOKENS.DeepLinkService)
    private readonly deepLinkService: DeepLinkService,
    @inject(MAIN_TOKENS.UrlLauncher)
    private readonly urlLauncher: IUrlLauncher,
    @inject(MAIN_TOKENS.MainWindow)
    private readonly mainWindow: IMainWindow,
  ) {
    super();

    this.deepLinkService.registerHandler("slack-integration", (_path, params) =>
      this.handleCallback(params),
    );
  }

  public async startFlow(
    region: CloudRegion,
    projectId: number,
  ): Promise<StartSlackFlowOutput> {
    try {
      const cloudUrl = getCloudUrlFromRegion(region);
      // Lands on PostHog Cloud's AccountConnected page, which forwards to
      // `posthog-code://slack-integration?…` with `integration_id` set.
      const nextPath = `/account-connected/slack-integration?provider=slack&project_id=${projectId}&connect_from=posthog_code`;
      const authorizeUrl = `${cloudUrl}/api/environments/${projectId}/integrations/authorize/?kind=slack&next=${encodeURIComponent(nextPath)}`;

      this.clearFlowTimeout();
      this.flowTimeout = setTimeout(() => {
        log.warn("Slack integration flow timed out", { projectId });
        this.flowTimeout = null;
        this.emit(SlackIntegrationEvent.FlowTimedOut, { projectId });
      }, FLOW_TIMEOUT_MS);

      await this.urlLauncher.launch(authorizeUrl);

      return { success: true };
    } catch (error) {
      this.clearFlowTimeout();
      log.error("Failed to start Slack integration flow", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  public consumePendingCallback(): SlackIntegrationCallback | null {
    const pending = this.pendingCallback;
    this.pendingCallback = null;
    return pending;
  }

  private handleCallback(params: URLSearchParams): boolean {
    const projectIdRaw = params.get("project_id");
    const parsedProjectId = projectIdRaw ? Number(projectIdRaw) : null;
    const integrationIdRaw = params.get("integration_id");
    const parsedIntegrationId = integrationIdRaw
      ? Number(integrationIdRaw)
      : null;
    const status = params.get("status") === "error" ? "error" : "success";

    const callback: SlackIntegrationCallback = {
      projectId:
        parsedProjectId !== null && Number.isFinite(parsedProjectId)
          ? parsedProjectId
          : null,
      integrationId:
        parsedIntegrationId !== null && Number.isFinite(parsedIntegrationId)
          ? parsedIntegrationId
          : null,
      status,
      errorCode: params.get("error_code") || null,
      errorMessage: params.get("error_message") || null,
    };

    this.clearFlowTimeout();

    if (status === "error") {
      log.error("Received Slack integration callback with error", {
        projectId: callback.projectId,
        errorCode: callback.errorCode,
        errorMessage: callback.errorMessage,
      });
    }

    const hasListeners = this.listenerCount(SlackIntegrationEvent.Callback) > 0;
    if (hasListeners) {
      this.emit(SlackIntegrationEvent.Callback, callback);
    } else {
      this.pendingCallback = callback;
    }

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    return true;
  }

  private clearFlowTimeout(): void {
    if (this.flowTimeout) {
      clearTimeout(this.flowTimeout);
      this.flowTimeout = null;
    }
  }
}
