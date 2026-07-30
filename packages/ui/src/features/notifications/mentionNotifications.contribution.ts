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

  // A batch is one notification, however many mentions it holds — one banner,
  // one sound. Copy narrows with what the batch shares: same author and task
  // name both; same task names the task and keeps click-through; mixed tasks
  // fall back to a count (no target — a click can't pick one task).
  private notifyAll(mentions: TaskMention[]): void {
    if (mentions.length === 0) return;
    if (mentions.length === 1) {
      const mention = mentions[0];
      this.bus.notify({
        body: `${authorName(mention)} mentioned you in "${taskTitle(mention)}"`,
        target: { kind: "task", taskId: mention.task_id },
        toast: {
          level: "warning",
          description: mentionPreview(mention.content),
        },
      });
      return;
    }
    const first = mentions[0];
    const newest = mentions[mentions.length - 1];
    if (mentions.some((mention) => mention.task_id !== first.task_id)) {
      this.bus.notify({
        body: `${mentions.length} new mentions from teammates`,
        toast: { level: "warning" },
      });
      return;
    }
    const sameAuthor = mentions.every(
      (mention) => mention.author?.uuid === first.author?.uuid,
    );
    this.bus.notify({
      body: sameAuthor
        ? `${authorName(first)} mentioned you ${mentions.length} times in "${taskTitle(first)}"`
        : `${mentions.length} new mentions in "${taskTitle(first)}"`,
      target: { kind: "task", taskId: first.task_id },
      toast: { level: "warning", description: mentionPreview(newest.content) },
    });
  }
}

function authorName(mention: TaskMention): string {
  return mention.author ? userDisplayName(mention.author) : "Someone";
}

function taskTitle(mention: TaskMention): string {
  return truncate(mention.task_title || "Untitled task", MAX_TITLE_LENGTH);
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
