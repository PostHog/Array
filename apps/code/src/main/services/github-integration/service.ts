import type { IMainWindow } from "@posthog/platform/main-window";
import type { IUrlLauncher } from "@posthog/platform/url-launcher";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { DeepLinkService } from "../deep-link/service";
import type { CloudRegion, StartGitHubFlowOutput } from "./schemas";

const log = logger.scope("github-integration-service");

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export const GitHubIntegrationEvent = {
  Callback: "callback",
  FlowTimedOut: "flowTimedOut",
} as const;

export interface IntegrationCallback {
  provider: string;
  projectId: number | null;
  installationId: string | null;
  status: "success" | "error";
  errorCode: string | null;
  errorMessage: string | null;
}

export interface FlowTimedOut {
  projectId: number;
}

export interface GitHubIntegrationEvents {
  [GitHubIntegrationEvent.Callback]: IntegrationCallback;
  [GitHubIntegrationEvent.FlowTimedOut]: FlowTimedOut;
}

@injectable()
export class GitHubIntegrationService extends TypedEventEmitter<GitHubIntegrationEvents> {
  private pendingCallback: IntegrationCallback | null = null;
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

    this.deepLinkService.registerHandler("integration", (_path, params) =>
      this.handleCallback(params),
    );
  }

  public async startFlow(
    region: CloudRegion,
    projectId: number,
  ): Promise<StartGitHubFlowOutput> {
    try {
      const cloudUrl = getCloudUrlFromRegion(region);
      const nextPath = `/account-connected/github-integration?provider=github&project_id=${projectId}&connect_from=posthog_code`;
      const authorizeUrl = `${cloudUrl}/api/environments/${projectId}/integrations/authorize/?kind=github&next=${encodeURIComponent(nextPath)}`;

      this.clearFlowTimeout();
      this.flowTimeout = setTimeout(() => {
        log.warn("GitHub integration flow timed out", { projectId });
        this.flowTimeout = null;
        this.emit(GitHubIntegrationEvent.FlowTimedOut, { projectId });
      }, FLOW_TIMEOUT_MS);

      await this.urlLauncher.launch(authorizeUrl);

      return { success: true };
    } catch (error) {
      this.clearFlowTimeout();
      log.error("Failed to start GitHub integration flow", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  public consumePendingCallback(): IntegrationCallback | null {
    const pending = this.pendingCallback;
    this.pendingCallback = null;
    return pending;
  }

  private handleCallback(params: URLSearchParams): boolean {
    const projectIdRaw = params.get("project_id");
    const parsedProjectId = projectIdRaw ? Number(projectIdRaw) : null;
    const status = params.get("status") === "error" ? "error" : "success";

    const callback: IntegrationCallback = {
      provider: params.get("provider") ?? "",
      projectId:
        parsedProjectId !== null && Number.isFinite(parsedProjectId)
          ? parsedProjectId
          : null,
      installationId: params.get("installation_id") || null,
      status,
      errorCode: params.get("error_code") || null,
      errorMessage: params.get("error_message") || null,
    };

    this.clearFlowTimeout();

    if (status === "error") {
      log.error("Received integration callback with error", {
        provider: callback.provider,
        projectId: callback.projectId,
        errorCode: callback.errorCode,
        errorMessage: callback.errorMessage,
      });
    }

    const hasListeners =
      this.listenerCount(GitHubIntegrationEvent.Callback) > 0;
    if (hasListeners) {
      this.emit(GitHubIntegrationEvent.Callback, callback);
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
