import {
  Bug,
  GitPullRequest,
  type Icon,
  ListChecks,
  NotePencil,
  Package,
  TestTube,
} from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import {
  type LoopFormValues,
  type LoopTriggerDraft,
  nextDraftTriggerKey,
} from "./loopFormTypes";

export interface LoopTemplate {
  id: string;
  icon: Icon;
  name: string;
  description: string;
  /** Short, human phrase describing the trigger, shown on the card. */
  triggerLabel: string;
  /** Integrations and surfaces the template works with, shown on the card. */
  worksWith: string[];
  /** Accent tone for the card's icon tile. */
  tone: "blue" | "red" | "purple" | "teal" | "amber" | "green";
  build: () => Partial<LoopFormValues>;
}

function scheduleDraft(cron: string): LoopTriggerDraft {
  return {
    key: nextDraftTriggerKey(),
    type: "schedule",
    enabled: true,
    config: { cron_expression: cron, timezone: "UTC" },
  };
}

function githubDraft(
  events: LoopSchemas.LoopGithubTriggerEventEnum[],
): LoopTriggerDraft {
  return {
    key: nextDraftTriggerKey(),
    type: "github",
    enabled: true,
    config: { github_integration_id: 0, repository: "", events },
  };
}

export const LOOP_TEMPLATES: LoopTemplate[] = [
  {
    id: "pr-review-digest",
    icon: GitPullRequest,
    name: "PR review digest",
    description:
      "Summarize open pull requests, their review and CI status, and what needs attention.",
    triggerLabel: "Runs weekdays at 11:00",
    worksWith: ["GitHub", "Slack"],
    tone: "blue",
    build: () => ({
      name: "PR review digest",
      instructions:
        "Summarize the open pull requests in this repository. For each, note its review status, CI status, and how long it has been waiting. Call out anything that needs attention, then post the summary to the team.",
      triggers: [scheduleDraft("0 11 * * 1-5")],
    }),
  },
  {
    id: "ci-failure-summary",
    icon: Bug,
    name: "CI failure summary",
    description:
      "Digest the failing CI runs from the last day and post a summary to your team channel.",
    triggerLabel: "Runs daily at 9:00",
    worksWith: ["GitHub", "Slack"],
    tone: "red",
    build: () => ({
      name: "CI failure summary",
      instructions:
        "Review the CI runs from the last 24 hours. Summarize which jobs failed, the likely cause of each, and any patterns across runs. Post the summary to the team channel.",
      triggers: [scheduleDraft("0 9 * * *")],
    }),
  },
  {
    id: "flaky-test-tracker",
    icon: TestTube,
    name: "Flaky test tracker",
    description:
      "Find tests that pass and fail intermittently across recent CI runs, and open an issue.",
    triggerLabel: "Runs Mondays at 9:00",
    worksWith: ["GitHub"],
    tone: "purple",
    build: () => ({
      name: "Flaky test tracker",
      instructions:
        "Look through recent CI runs and identify tests that pass and fail intermittently on unchanged code. List the flakiest tests with links to failing runs, and open an issue tracking them.",
      triggers: [scheduleDraft("0 9 * * 1")],
    }),
  },
  {
    id: "dependency-update-check",
    icon: Package,
    name: "Dependency update check",
    description:
      "Scan for outdated packages, security patches, and breaking changes, then open a PR.",
    triggerLabel: "Runs Mondays at 11:30",
    worksWith: ["GitHub"],
    tone: "teal",
    build: () => ({
      name: "Dependency update check",
      instructions:
        "Check this repository's dependencies for outdated versions, security advisories, and breaking changes. Open a pull request that bumps the safe updates and summarize anything that needs manual review.",
      triggers: [scheduleDraft("30 11 * * 1")],
    }),
  },
  {
    id: "release-notes-drafter",
    icon: NotePencil,
    name: "Release notes drafter",
    description:
      "Draft user-facing release notes each time a pull request merges to the main branch.",
    triggerLabel: "Triggered when a PR merges",
    worksWith: ["GitHub"],
    tone: "amber",
    build: () => ({
      name: "Release notes drafter",
      instructions:
        "When a pull request merges to the main branch, draft a user-facing release note for the change: what changed, why it matters, and any migration steps. Keep the tone plain and concrete.",
      triggers: [githubDraft(["pull_request"])],
    }),
  },
  {
    id: "issue-triage",
    icon: ListChecks,
    name: "Issue triage",
    description:
      "Review new issues, categorize bugs and feature requests, and flag likely duplicates.",
    triggerLabel: "Triggered by new issues",
    worksWith: ["GitHub"],
    tone: "green",
    build: () => ({
      name: "Issue triage",
      instructions:
        "When a new issue is opened, categorize it (bug, feature request, question, or docs), assess its severity, and check whether it duplicates an existing issue. Apply the right labels and comment with your reasoning.",
      triggers: [githubDraft(["issues"])],
    }),
  },
];
