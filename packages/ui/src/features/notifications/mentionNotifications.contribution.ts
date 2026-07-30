import {
  advanceMentionWatch,
  baselineMentionWatch,
  INITIAL_MENTION_WATCH_STATE,
  type MentionWatchState,
} from "@posthog/core/canvas/mentionNotifications";
import type { Contribution } from "@posthog/di/contribution";
import { splitMentionSegments } from "@posthog/shared";
import type { TaskMention } from "@posthog/shared/domain-types";
import { TASK_MENTIONS_QUERY_KEY } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { inject, injectable } from "inversify";
import { NotificationBus } from "./notifications";

// Past this, individual notifications read as spam; collapse to one summary.
const MAX_INDIVIDUAL_NOTIFICATIONS = 3;
const MAX_TITLE_LENGTH = 50;
const MAX_PREVIEW_LENGTH = 120;

/**
 * Routes new @-mentions of the current user through the NotificationBus, so
 * they get the same suppression, settings gating, sound, and click-through-to-
 * task as agent activity.
 *
 * Rides the mentions query the channels UI already polls (`useMentionActivity`)
 * rather than fetching itself — one poll, one source of truth. Notifications
 * therefore live where the spaces layout lives, which is where the product is
 * headed anyway.
 */
@injectable()
export class MentionNotificationsContribution implements Contribution {
  private state: MentionWatchState = INITIAL_MENTION_WATCH_STATE;

  constructor(
    @inject(NotificationBus) private readonly bus: NotificationBus,
    @inject(IMPERATIVE_QUERY_CLIENT)
    private readonly queryClient: ImperativeQueryClient,
  ) {}

  start(): void {
    this.queryClient.getQueryCache().subscribe((event) => {
      if (!isTaskMentionsKey(event.query.queryKey)) return;
      if (event.type === "removed") {
        // Auth-scoped queries are removed on logout; re-baseline so the next
        // account's backlog stays silent.
        this.state = INITIAL_MENTION_WATCH_STATE;
        return;
      }
      if (event.type !== "updated") return;
      if (event.query.meta?.authScoped !== true) return;
      const mentions = event.query.state.data as TaskMention[] | undefined;
      if (mentions) this.absorb(mentions);
    });
  }

  private absorb(mentions: readonly TaskMention[]): void {
    if (this.state.seenThrough === null) {
      // The first page after boot or login is backlog, not news.
      this.state = baselineMentionWatch(mentions, new Date().toISOString());
      return;
    }
    const { state, toNotify } = advanceMentionWatch(this.state, mentions);
    this.state = state;
    this.notifyAll(toNotify);
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
    // One meep per batch, not per mention: mute the sound on every
    // notification after the first that actually delivered (a suppressed
    // mention — its task is being viewed — shouldn't spend the batch's sound).
    let sounded = false;
    for (const mention of mentions) {
      const author = mention.author
        ? userDisplayName(mention.author)
        : "Someone";
      const title = truncate(
        mention.task_title || "Untitled task",
        MAX_TITLE_LENGTH,
      );
      const channel = this.bus.notify({
        body: `${author} mentioned you in "${title}"`,
        target: { kind: "task", taskId: mention.task_id },
        muteSound: sounded,
        toast: {
          level: "warning",
          description: mentionPreview(mention.content),
        },
      });
      if (channel !== "suppress") sounded = true;
    }
  }
}

function isTaskMentionsKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && queryKey[0] === TASK_MENTIONS_QUERY_KEY[0];
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
