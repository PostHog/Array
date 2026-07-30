import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import {
  advanceMentionWatch,
  baselineMentionWatch,
  INITIAL_MENTION_WATCH_STATE,
  type MentionWatchState,
} from "@posthog/core/canvas/mentionNotifications";
import type { Contribution } from "@posthog/di/contribution";
import { splitMentionSegments } from "@posthog/shared";
import type { TaskMention } from "@posthog/shared/domain-types";
import { getAuthenticatedClient } from "@posthog/ui/features/auth/authClientImperative";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { logger } from "@posthog/ui/shell/logger";
import { inject, injectable } from "inversify";
import { NotificationBus } from "./notifications";

const POLL_INTERVAL_MS = 60_000;
// Past this, individual notifications read as spam; collapse to one summary.
const MAX_INDIVIDUAL_NOTIFICATIONS = 3;
const MAX_TITLE_LENGTH = 50;
const MAX_PREVIEW_LENGTH = 120;

type MentionsClient = Pick<PostHogAPIClient, "getTaskMentions">;

const log = logger.scope("mention-notifications");

/**
 * Polls the mentions index and routes new @-mentions of the current user
 * through the NotificationBus, so they get the same suppression, settings
 * gating, sound, and click-through-to-task as agent activity.
 */
@injectable()
export class MentionNotificationsContribution implements Contribution {
  private state: MentionWatchState = INITIAL_MENTION_WATCH_STATE;
  private inFlight = false;

  // Instance field rather than an injected dependency: resolving auth per tick
  // covers login, logout, and project switches without subscription plumbing,
  // and tests swap it for a stub.
  getClient: () => Promise<MentionsClient | null> = getAuthenticatedClient;

  constructor(@inject(NotificationBus) private readonly bus: NotificationBus) {}

  start(): void {
    void this.tick();
    setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const client = await this.getClient();
      if (!client) {
        // Logged out: re-baseline on next login so another account's backlog
        // doesn't fire as new mentions.
        this.state = INITIAL_MENTION_WATCH_STATE;
        return;
      }
      const since = this.state.seenThrough;
      const mentions = await client.getTaskMentions(
        since ? { since } : undefined,
      );
      if (since === null) {
        this.state = baselineMentionWatch(mentions, new Date().toISOString());
        return;
      }
      const { state, toNotify } = advanceMentionWatch(this.state, mentions);
      this.state = state;
      this.notifyAll(toNotify);
    } catch (error) {
      log.warn("Mention poll failed", { error });
    } finally {
      this.inFlight = false;
    }
  }

  private notifyAll(mentions: TaskMention[]): void {
    if (mentions.length === 0) return;
    if (mentions.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
      this.bus.notify({
        body: `${mentions.length} new mentions from teammates`,
        toast: { level: "warning" },
      });
      return;
    }
    for (const mention of mentions) {
      const author = mention.author
        ? userDisplayName(mention.author)
        : "Someone";
      const title = truncate(
        mention.task_title || "Untitled task",
        MAX_TITLE_LENGTH,
      );
      this.bus.notify({
        body: `${author} mentioned you in "${title}"`,
        target: { kind: "task", taskId: mention.task_id },
        toast: {
          level: "warning",
          description: mentionPreview(mention.content),
        },
      });
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function mentionPreview(content: string): string | undefined {
  const plain = splitMentionSegments(content)
    .map((segment) =>
      segment.type === "mention" ? `@${segment.name}` : segment.text,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? truncate(plain, MAX_PREVIEW_LENGTH) : undefined;
}
