import type { GithubRef, NewTaskLinkPayload } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { describe, expect, it, vi } from "vitest";
import type { GitHubIssueClient } from "./identifiers";
import { NewTaskLinkResolver } from "./newTaskLinkResolver";

function makeIssue(overrides: Partial<GithubRef> = {}): GithubRef {
  return {
    kind: "issue",
    number: 7,
    title: "Fix the bug",
    state: "OPEN",
    labels: [],
    url: "https://github.com/acme/web/issues/7",
    repo: "acme/web",
    ...overrides,
  };
}

function makeResolver(
  getGithubIssue: GitHubIssueClient["getGithubIssue"],
): NewTaskLinkResolver {
  return new NewTaskLinkResolver({ getGithubIssue });
}

describe("NewTaskLinkResolver", () => {
  it("maps a new-action payload to navigation options", async () => {
    const resolver = makeResolver(vi.fn());
    const payload: NewTaskLinkPayload = {
      action: "new",
      prompt: "do a thing",
      repo: "acme/web",
      model: "sonnet",
      mode: "plan",
    };

    const result = await resolver.resolve(payload);

    expect(result.kind).toBe("navigate");
    if (result.kind !== "navigate") return;
    expect(result.navigation).toEqual({
      initialPrompt: "do a thing",
      initialCloudRepository: "acme/web",
      initialModel: "sonnet",
      initialMode: "plan",
    });
    expect(result.analytics.event).toBe(ANALYTICS_EVENTS.DEEP_LINK_NEW_TASK);
    if (result.analytics.event !== ANALYTICS_EVENTS.DEEP_LINK_NEW_TASK) return;
    expect(result.analytics.properties.has_prompt).toBe(true);
  });

  it("uses the decoded plan as the prompt for a plan-action payload", async () => {
    const resolver = makeResolver(vi.fn());
    const payload: NewTaskLinkPayload = { action: "plan", plan: "step one" };

    const result = await resolver.resolve(payload);

    expect(result.kind).toBe("navigate");
    if (result.kind !== "navigate") return;
    expect(result.navigation.initialPrompt).toBe("step one");
    expect(result.analytics.event).toBe(ANALYTICS_EVENTS.DEEP_LINK_PLAN);
    if (result.analytics.event !== ANALYTICS_EVENTS.DEEP_LINK_PLAN) return;
    expect(result.analytics.properties.plan_length_chars).toBe(8);
  });

  it("derives prompt, repo and labels for a found issue", async () => {
    const getGithubIssue = vi
      .fn<GitHubIssueClient["getGithubIssue"]>()
      .mockResolvedValue(makeIssue({ labels: ["bug", "p1"] }));
    const resolver = makeResolver(getGithubIssue);
    const payload: NewTaskLinkPayload = {
      action: "issue",
      url: "https://github.com/acme/web/issues/7",
      owner: "acme",
      issueRepo: "web",
      issueNumber: 7,
    };

    const result = await resolver.resolve(payload);

    expect(getGithubIssue).toHaveBeenCalledWith("acme", "web", 7);
    expect(result.kind).toBe("navigate");
    if (result.kind !== "navigate") return;
    expect(result.navigation.initialPrompt).toBe(
      "GitHub Issue: Fix the bug\nhttps://github.com/acme/web/issues/7\nLabels: bug, p1",
    );
    expect(result.navigation.initialCloudRepository).toBe("acme/web");
    expect(result.analytics.event).toBe(ANALYTICS_EVENTS.DEEP_LINK_ISSUE);
  });

  it("prefers an explicit repo over the issue owner/repo default", async () => {
    const resolver = makeResolver(vi.fn().mockResolvedValue(makeIssue()));
    const payload: NewTaskLinkPayload = {
      action: "issue",
      url: "https://github.com/acme/web/issues/7",
      owner: "acme",
      issueRepo: "web",
      issueNumber: 7,
      repo: "acme/override",
    };

    const result = await resolver.resolve(payload);

    if (result.kind !== "navigate") throw new Error("expected navigate");
    expect(result.navigation.initialCloudRepository).toBe("acme/override");
  });

  it("classifies a missing issue as not_found", async () => {
    const resolver = makeResolver(vi.fn().mockResolvedValue(null));
    const payload: NewTaskLinkPayload = {
      action: "issue",
      url: "https://github.com/acme/web/issues/7",
      owner: "acme",
      issueRepo: "web",
      issueNumber: 7,
    };

    const result = await resolver.resolve(payload);

    expect(result.kind).toBe("not_found");
    if (result.analytics.event !== ANALYTICS_EVENTS.DEEP_LINK_ISSUE_FAILED)
      return;
    expect(result.analytics.properties.reason).toBe("not_found");
  });

  it("classifies a thrown fetch as fetch_failed and carries the message", async () => {
    const resolver = makeResolver(
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const payload: NewTaskLinkPayload = {
      action: "issue",
      url: "https://github.com/acme/web/issues/7",
      owner: "acme",
      issueRepo: "web",
      issueNumber: 7,
    };

    const result = await resolver.resolve(payload);

    expect(result.kind).toBe("fetch_failed");
    if (result.kind !== "fetch_failed") return;
    expect(result.description).toBe("network down");
    if (result.analytics.event !== ANALYTICS_EVENTS.DEEP_LINK_ISSUE_FAILED)
      return;
    expect(result.analytics.properties.error_message).toBe("network down");
  });
});
