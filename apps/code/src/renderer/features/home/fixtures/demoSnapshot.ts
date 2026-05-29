import { classify } from "@shared/types/workflow-classify";
import type {
  HomePullRequest,
  HomeSnapshot,
  HomeWorkstream,
} from "../hooks/useHomeSnapshot";

function withSituations(
  workstreams: Omit<HomeWorkstream, "situations">[],
): HomeWorkstream[] {
  const now = Date.now();
  return workstreams.map((ws) => ({
    ...ws,
    situations: Array.from(
      classify({
        hasPrUrl: !!ws.prUrl,
        pr: ws.pr
          ? {
              state: ws.pr.state,
              ciStatus: ws.pr.ciStatus,
              reviewDecision: ws.pr.reviewDecision,
              unresolvedThreads: ws.pr.unresolvedThreads,
              isCurrentUserAuthor: ws.pr.isCurrentUserAuthor,
            }
          : null,
        branch: ws.branch,
        lastActivityAt: ws.lastActivityAt,
        now,
      }),
    ),
  }));
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = () => Date.now();

function pr(
  overrides: Partial<HomePullRequest> & { url: string },
): HomePullRequest {
  return {
    number: 0,
    title: "",
    state: "open",
    ciStatus: "passing",
    unresolvedThreads: 0,
    reviewDecision: null,
    isCurrentUserRequestedReviewer: false,
    isCurrentUserAuthor: true,
    author: "peter",
    lastUpdatedAt: now() - HOUR,
    ...overrides,
  };
}

export function buildDemoSnapshot(): HomeSnapshot {
  const t = now();

  const needsAttention: Omit<HomeWorkstream, "situations">[] = [
    // ── Critical: CI failing ───────────────────────────────────────────────
    {
      id: "demo-attn-ci",
      repoName: "posthog",
      branch: "feat/cohort-batch-export",
      prUrl: "https://github.com/posthog/posthog/pull/29412",
      pr: pr({
        url: "https://github.com/posthog/posthog/pull/29412",
        number: 29412,
        title: "Batch export support for cohorts",
        state: "open",
        ciStatus: "failing",
        unresolvedThreads: 0,
        reviewDecision: "review_required",
        lastUpdatedAt: t - 45 * 60_000,
      }),
      tasks: [
        {
          id: "demo-task-ci-1",
          title: "Add cohort batch export endpoint",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 45 * 60_000,
    },

    // ── Critical: CI failing + unresolved comments (stacked attentions) ────
    {
      id: "demo-attn-ci-comments",
      repoName: "posthog-js",
      branch: "fix/web-vitals-sampling",
      prUrl: "https://github.com/posthog/posthog-js/pull/1820",
      pr: pr({
        url: "https://github.com/posthog/posthog-js/pull/1820",
        number: 1820,
        title: "Sample web-vitals at session boundary",
        state: "open",
        ciStatus: "failing",
        unresolvedThreads: 2,
        reviewDecision: "changes_requested",
        lastUpdatedAt: t - 4 * HOUR,
      }),
      tasks: [
        {
          id: "demo-task-ci-comments-1",
          title: "Sample web-vitals at session boundary",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
        {
          id: "demo-task-ci-comments-2",
          title: "Address review feedback",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 4 * HOUR,
    },

    // ── Attention: Review requested on me ──────────────────────────────────
    {
      id: "demo-attn-review-1",
      repoName: "posthog",
      branch: "feat/insights-formula-cleanup",
      prUrl: "https://github.com/posthog/posthog/pull/29385",
      pr: pr({
        url: "https://github.com/posthog/posthog/pull/29385",
        number: 29385,
        title: "Refactor insights formula parser",
        state: "open",
        ciStatus: "passing",
        unresolvedThreads: 0,
        reviewDecision: "review_required",
        isCurrentUserAuthor: false,
        isCurrentUserRequestedReviewer: true,
        author: "thomas",
        lastUpdatedAt: t - 6 * HOUR,
      }),
      tasks: [],
      lastActivityAt: t - 6 * HOUR,
    },

    // ── Attention: Review requested on me (urgent / older) ─────────────────
    {
      id: "demo-attn-review-2",
      repoName: "posthog",
      branch: "fix/billing-quota-display",
      prUrl: "https://github.com/posthog/posthog/pull/29298",
      pr: pr({
        url: "https://github.com/posthog/posthog/pull/29298",
        number: 29298,
        title: "Fix billing quota off-by-one in usage modal",
        state: "open",
        ciStatus: "passing",
        unresolvedThreads: 0,
        reviewDecision: "review_required",
        isCurrentUserAuthor: false,
        isCurrentUserRequestedReviewer: true,
        author: "raquel",
        lastUpdatedAt: t - 2 * DAY,
      }),
      tasks: [],
      lastActivityAt: t - 2 * DAY,
    },

    // ── Attention: PR has unresolved comments on my PR ─────────────────────
    {
      id: "demo-attn-comments",
      repoName: "posthog-code",
      branch: "posthog-code/skill-buttons-v2",
      prUrl: "https://github.com/posthog/posthog-code/pull/2401",
      pr: pr({
        url: "https://github.com/posthog/posthog-code/pull/2401",
        number: 2401,
        title: "Skill buttons v2 — bundled, custom, and recent groups",
        state: "open",
        ciStatus: "passing",
        unresolvedThreads: 3,
        reviewDecision: "changes_requested",
        lastUpdatedAt: t - 90 * 60_000,
      }),
      tasks: [
        {
          id: "demo-task-comments-1",
          title: "Skill buttons v2 layout",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 90 * 60_000,
    },

    // ── Attention: PR ready to merge ───────────────────────────────────────
    {
      id: "demo-attn-merge",
      repoName: "posthog",
      branch: "feat/experiments-secondary-metrics",
      prUrl: "https://github.com/posthog/posthog/pull/29381",
      pr: pr({
        url: "https://github.com/posthog/posthog/pull/29381",
        number: 29381,
        title: "Secondary metrics in experiments view",
        state: "open",
        ciStatus: "passing",
        unresolvedThreads: 0,
        reviewDecision: "approved",
        lastUpdatedAt: t - 30 * 60_000,
      }),
      tasks: [
        {
          id: "demo-task-merge-1",
          title: "Add secondary metrics to experiment view",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 30 * 60_000,
    },

    // ── Quiet: Stale branch with no PR ─────────────────────────────────────
    {
      id: "demo-attn-stale-1",
      repoName: "posthog-code",
      branch: "posthog-code/onboarding-copy",
      prUrl: null,
      pr: null,
      tasks: [
        {
          id: "demo-task-stale-1",
          title: "Tweak onboarding copy for empty state",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 2 * DAY - 3 * HOUR,
    },

    // ── Quiet: Stale branch with 2 task runs ───────────────────────────────
    {
      id: "demo-attn-stale-2",
      repoName: "posthog",
      branch: "exp/funnel-paths-refactor",
      prUrl: null,
      pr: null,
      tasks: [
        {
          id: "demo-task-stale-2a",
          title: "Refactor funnel path computation",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
        {
          id: "demo-task-stale-2b",
          title: "Self-review funnel refactor",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 4 * DAY - 12 * HOUR,
    },

    // ── Quiet: Merged PR with leftover worktree ────────────────────────────
    {
      id: "demo-attn-cleanup",
      repoName: "posthog-js",
      branch: "fix/autocapture-shadow-dom",
      prUrl: "https://github.com/posthog/posthog-js/pull/1789",
      pr: pr({
        url: "https://github.com/posthog/posthog-js/pull/1789",
        number: 1789,
        title: "Capture clicks inside shadow DOM",
        state: "merged",
        ciStatus: "passing",
        unresolvedThreads: 0,
        reviewDecision: "approved",
        lastUpdatedAt: t - 5 * DAY,
      }),
      tasks: [
        {
          id: "demo-task-cleanup-1",
          title: "Capture clicks inside shadow DOM",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 5 * DAY,
    },
  ];

  const inProgress: Omit<HomeWorkstream, "situations">[] = [
    {
      id: "demo-ip-pr-open",
      repoName: "posthog",
      branch: "feat/cdp-hog-flow-retries",
      prUrl: "https://github.com/posthog/posthog/pull/29402",
      pr: pr({
        url: "https://github.com/posthog/posthog/pull/29402",
        number: 29402,
        title: "Hog Flow: per-step retry policy",
        state: "open",
        ciStatus: "passing",
        unresolvedThreads: 0,
        reviewDecision: "review_required",
        lastUpdatedAt: t - 5 * HOUR,
      }),
      tasks: [
        {
          id: "demo-task-ip-pr-open-1",
          title: "Per-step retry policy for Hog Flow",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 5 * HOUR,
    },
    {
      id: "demo-ip-draft",
      repoName: "posthog",
      branch: "exp/web-experiments-headless",
      prUrl: "https://github.com/posthog/posthog/pull/29397",
      pr: pr({
        url: "https://github.com/posthog/posthog/pull/29397",
        number: 29397,
        title: "Headless mode for web experiments runner",
        state: "draft",
        ciStatus: "pending",
        unresolvedThreads: 0,
        reviewDecision: null,
        lastUpdatedAt: t - 2 * HOUR,
      }),
      tasks: [
        {
          id: "demo-task-ip-draft-1",
          title: "Headless mode for web experiments",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 2 * HOUR,
    },
    {
      id: "demo-ip-no-pr",
      repoName: "posthog-docs",
      branch: "docs/error-tracking-quickstart",
      prUrl: null,
      pr: null,
      tasks: [
        {
          id: "demo-task-ip-no-pr-1",
          title: "Draft error tracking quickstart",
          status: "completed",
          isGenerating: false,
          needsPermission: false,
        },
      ],
      lastActivityAt: t - 90 * 60_000,
    },
  ];

  return {
    activeAgents: [
      {
        taskId: "demo-agent-1",
        title: "Add Home tab to sidebar",
        repoName: "posthog-code",
        branch: "posthog-code/home-tab",
        status: "in_progress",
        lastActivityAt: t - 2 * 60_000,
        needsPermission: false,
        cloudPrUrl: null,
      },
      {
        taskId: "demo-agent-2",
        title: "Migrate event ingestion to new schema",
        repoName: "posthog",
        branch: "feat/ingest-v2",
        status: "in_progress",
        lastActivityAt: t - 18 * 60_000,
        needsPermission: true,
        cloudPrUrl: null,
      },
      {
        taskId: "demo-agent-3",
        title: "Investigate replay player frame drops",
        repoName: "posthog",
        branch: "fix/replay-frame-drops",
        status: "queued",
        lastActivityAt: t - 35 * 60_000,
        needsPermission: false,
        cloudPrUrl: null,
      },
      {
        taskId: "demo-agent-4",
        title: "Review billing-quota-display PR",
        repoName: "posthog",
        branch: "review/29298",
        status: "in_progress",
        lastActivityAt: t - 4 * 60_000,
        needsPermission: false,
        cloudPrUrl: null,
      },
    ],
    needsAttention: withSituations(needsAttention),
    inProgress: withSituations(inProgress),
  };
}

export const EMPTY_SNAPSHOT: HomeSnapshot = {
  activeAgents: [],
  needsAttention: [],
  inProgress: [],
};
