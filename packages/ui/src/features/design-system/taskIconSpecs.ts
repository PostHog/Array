import type { TaskStatusInput } from "@posthog/ui/features/sidebar/components/items/taskStatusVocabulary";

/**
 * One dummy task in a known state. The row's label is the *vocabulary* for that
 * state rather than a task title: the page exists to agree on what each state
 * means, and saying it in the row beats a legend the eye has to cross-reference.
 * The phrases also run long enough to overflow a nav column, which is what
 * makes the hover ticker worth looking at.
 */
export interface TaskIconSpec {
  id: string;
  vocab: string;
  /** Dummy relative age, so the shipped row's trailing timestamp is realistic. */
  age: string;
  props: TaskStatusInput;
}

/** A run of states that answer the same question, kept as a nav section. */
export interface TaskIconSpecGroup {
  label: string;
  specs: TaskIconSpec[];
}

const SLACK_THREAD_URL = "https://posthog.slack.com/archives/C000/p000";

/**
 * Every state `TaskIcon`'s cascade can land on, grouped by the question the
 * icon is answering. Order inside a group follows the cascade's own priority,
 * so a column read top-to-bottom is also a read of which state wins.
 */
export const TASK_ICON_SPEC_GROUPS: readonly TaskIconSpecGroup[] = [
  {
    label: "Needs you",
    specs: [
      {
        id: "needs-permission",
        vocab: "Needs permission — blocked, wants you now",
        age: "2m",
        props: { needsPermission: true },
      },
      {
        id: "generating",
        vocab: "Working — the agent is producing output right now",
        age: "4m",
        props: { isGenerating: true },
      },
      {
        id: "unread",
        vocab: "Unread — there is something here to read",
        age: "just now",
        props: { isUnread: true, prState: "open" },
      },
    ],
  },
  {
    label: "Local work",
    specs: [
      {
        id: "local-idle",
        vocab: "Idle — nothing running, nothing changed",
        age: "11m",
        props: {},
      },
      {
        id: "local-diff",
        vocab: "Has changes — uncommitted work on the branch",
        age: "18m",
        props: { hasDiff: true },
      },
      {
        id: "suspended",
        vocab: "Suspended — parked, resume when you want",
        age: "26m",
        props: { isSuspended: true },
      },
    ],
  },
  {
    label: "Pull requests",
    specs: [
      {
        id: "pr-draft",
        vocab: "Draft PR — open, not asking for review",
        age: "41m",
        props: { prState: "draft" },
      },
      {
        id: "pr-open",
        vocab: "PR ready — open and waiting on review",
        age: "52m",
        props: { prState: "open" },
      },
      {
        id: "pr-merged",
        vocab: "Merged — landed on the base branch",
        age: "1h",
        props: { prState: "merged" },
      },
      {
        id: "pr-closed",
        vocab: "PR closed — shut without merging",
        age: "1h",
        props: { prState: "closed" },
      },
    ],
  },
  {
    // Deliberately undramatic. Run mechanics — queued, claiming a sandbox,
    // erroring out — are ours, not the reader's, so most of this group collapses
    // into "working", "something to read", or silence. The task detail is where
    // a run explains itself.
    label: "Cloud runs",
    specs: [
      {
        id: "cloud-not-started",
        vocab: "Not picked up yet — quiet, nothing has happened",
        age: "2h",
        props: { workspaceMode: "cloud" },
      },
      {
        id: "cloud-queued",
        vocab: "Starting — same as working, on purpose",
        age: "2h",
        props: { workspaceMode: "cloud", taskRunStatus: "queued" },
      },
      {
        id: "cloud-running",
        vocab: "Working — no mechanics, just magic",
        age: "3h",
        props: { workspaceMode: "cloud", taskRunStatus: "in_progress" },
      },
      {
        id: "cloud-completed-unread",
        vocab: "Done — output you haven't read",
        age: "4h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "completed",
          isUnread: true,
        },
      },
      {
        id: "cloud-completed-seen",
        vocab: "Done and read — nothing owed, no badge of honour",
        age: "4h",
        props: { workspaceMode: "cloud", taskRunStatus: "completed" },
      },
      {
        id: "cloud-cancelled",
        vocab: "Stopped — quiet, it just isn't running",
        age: "5h",
        props: { workspaceMode: "cloud", taskRunStatus: "cancelled" },
      },
      {
        id: "cloud-babysitting-ci",
        vocab:
          "PR open, run still says in_progress — quiet, the PR is the story",
        age: "4h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "in_progress",
          prState: "open",
        },
      },
      {
        id: "cloud-pr-unresolved",
        vocab: "PR opened, state not resolved yet — badge without a verdict",
        age: "5h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "in_progress",
          prUrl: "https://github.com/PostHog/code/pull/3960",
        },
      },
      {
        id: "cloud-failed",
        vocab: "Run broke — reads as unread, the detail explains why",
        age: "6h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "failed",
          isUnread: true,
        },
      },
    ],
  },
  {
    // Every origin shares one source badge now, so this group is really a test
    // of whether its tooltip is enough to tell them apart.
    label: "Origins",
    specs: [
      {
        id: "origin-slack-local",
        vocab: "From Slack — local run",
        age: "8h",
        props: {
          originProduct: "slack",
          slackThreadUrl: SLACK_THREAD_URL,
        },
      },
      {
        id: "origin-slack-running",
        vocab: "From Slack — working",
        age: "9h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "in_progress",
          originProduct: "slack",
          slackThreadUrl: SLACK_THREAD_URL,
        },
      },
      {
        id: "origin-signal-report",
        vocab: "From Signals — working",
        age: "11h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "in_progress",
          originProduct: "signal_report",
        },
      },
      {
        id: "origin-signals-scout",
        vocab: "From a Signals scout — ready",
        age: "13h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "completed",
          originProduct: "signals_scout",
        },
      },
      {
        id: "origin-support-queue",
        vocab: "From the support queue — local run",
        age: "16h",
        props: { originProduct: "support_queue" },
      },
      {
        id: "origin-session-summaries",
        vocab: "From session summaries — ready",
        age: "18h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "completed",
          originProduct: "session_summaries",
        },
      },
      {
        id: "origin-error-tracking",
        vocab: "From error tracking — its run broke, reads as unread",
        age: "21h",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "failed",
          originProduct: "error_tracking",
          isUnread: true,
        },
      },
      {
        id: "origin-eval-clusters",
        vocab: "From evals — local run",
        age: "1d",
        props: { originProduct: "eval_clusters" },
      },
      {
        id: "origin-automation",
        vocab: "From an automation — starting",
        age: "1d",
        props: {
          workspaceMode: "cloud",
          taskRunStatus: "queued",
          originProduct: "automation",
        },
      },
    ],
  },
];
