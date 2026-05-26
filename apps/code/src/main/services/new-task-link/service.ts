import type { IMainWindow } from "@posthog/platform/main-window";
import type { NewTaskLinkPayload, NewTaskSharedParams } from "@shared/types";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { DeepLinkService } from "../deep-link/service";

const log = logger.scope("new-task-link-service");

function decodePlanBase64(encoded: string): string | null {
  try {
    const normalized = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/ /g, "+");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    if (!/^[A-Za-z0-9+/]*=*$/.test(padded)) return null;
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export const NewTaskLinkEvent = {
  Action: "action",
} as const;

export type { NewTaskLinkPayload };

export interface NewTaskLinkEvents {
  [NewTaskLinkEvent.Action]: NewTaskLinkPayload;
}

@injectable()
export class NewTaskLinkService extends TypedEventEmitter<NewTaskLinkEvents> {
  private pendingLink: NewTaskLinkPayload | null = null;

  constructor(
    @inject(MAIN_TOKENS.DeepLinkService)
    private readonly deepLinkService: DeepLinkService,
    @inject(MAIN_TOKENS.MainWindow)
    private readonly mainWindow: IMainWindow,
  ) {
    super();

    this.deepLinkService.registerHandler("new", (_path, params) =>
      this.handleNew(params),
    );
    this.deepLinkService.registerHandler("plan", (_path, params) =>
      this.handlePlan(params),
    );
    this.deepLinkService.registerHandler("issue", (_path, params) =>
      this.handleIssue(params),
    );
  }

  private extractSharedParams(params: URLSearchParams): NewTaskSharedParams {
    return {
      repo: params.get("repo") ?? undefined,
      mode: params.get("mode") ?? undefined,
      model: params.get("model") ?? undefined,
    };
  }

  private handleNew(params: URLSearchParams): boolean {
    const shared = this.extractSharedParams(params);
    const prompt = params.get("prompt") ?? undefined;

    if (!prompt && !shared.repo) {
      log.warn("New task link requires at least prompt or repo");
      return false;
    }

    const payload: NewTaskLinkPayload = {
      action: "new",
      prompt,
      ...shared,
    };

    log.info("Handling new task link", {
      hasPrompt: !!prompt,
      repo: shared.repo,
    });
    return this.emitOrQueue(payload);
  }

  private handlePlan(params: URLSearchParams): boolean {
    const planEncoded = params.get("plan");

    if (!planEncoded) {
      log.warn("Plan link missing plan parameter");
      return false;
    }

    const plan = decodePlanBase64(planEncoded);
    if (plan === null) {
      log.error("Plan link has invalid base64 encoding");
      return false;
    }

    const shared = this.extractSharedParams(params);
    const payload: NewTaskLinkPayload = {
      action: "plan",
      plan,
      ...shared,
    };

    log.info("Handling plan link", {
      planLength: plan.length,
      repo: shared.repo,
    });
    return this.emitOrQueue(payload);
  }

  private handleIssue(params: URLSearchParams): boolean {
    const url = params.get("url");

    if (!url) {
      log.warn("Issue link missing url parameter");
      return false;
    }

    const parsed = this.parseGitHubIssueUrl(url);
    if (!parsed) {
      log.warn("Issue link has invalid GitHub issue URL", { url });
      return false;
    }

    const shared = this.extractSharedParams(params);
    const payload: NewTaskLinkPayload = {
      action: "issue",
      url,
      owner: parsed.owner,
      issueRepo: parsed.repo,
      issueNumber: parsed.number,
      ...shared,
    };

    log.info("Handling issue link", {
      owner: parsed.owner,
      repo: parsed.repo,
      number: parsed.number,
    });
    return this.emitOrQueue(payload);
  }

  private parseGitHubIssueUrl(
    url: string,
  ): { owner: string; repo: string; number: number } | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "github.com") return null;

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length !== 4 || parts[2] !== "issues") return null;

      const issueNumber = Number.parseInt(parts[3], 10);
      if (Number.isNaN(issueNumber) || issueNumber <= 0) return null;

      return { owner: parts[0], repo: parts[1], number: issueNumber };
    } catch {
      return null;
    }
  }

  private emitOrQueue(payload: NewTaskLinkPayload): boolean {
    const hasListeners = this.listenerCount(NewTaskLinkEvent.Action) > 0;

    if (hasListeners) {
      log.info(`Emitting new task link event: action=${payload.action}`);
      this.emit(NewTaskLinkEvent.Action, payload);
    } else {
      log.info(
        `Queueing new task link (renderer not ready): action=${payload.action}`,
      );
      this.pendingLink = payload;
    }

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    return true;
  }

  public consumePendingLink(): NewTaskLinkPayload | null {
    const pending = this.pendingLink;
    this.pendingLink = null;
    if (pending) {
      log.info(`Consumed pending new task link: action=${pending.action}`);
    }
    return pending;
  }
}
