import { describe, expect, it } from "vitest";
import { agentIngressBaseUrl } from "./ingress";

describe("agentIngressBaseUrl", () => {
  it.each([
    { slug: "my-agent", region: "us" as const },
    { slug: "agent1", region: "us" as const },
    { slug: "agent-builder", region: "eu" as const },
    { slug: "a".repeat(63), region: "us" as const },
  ])("builds a host for the valid slug $slug", ({ slug, region }) => {
    expect(agentIngressBaseUrl(slug, region)).toBe(
      `https://${slug}.agents.${region}.posthog.com`,
    );
  });

  it("keeps the slug in the dev ingress path", () => {
    expect(agentIngressBaseUrl("my-agent", "dev")).toBe(
      "http://localhost:3030/agents/my-agent",
    );
  });

  it.each([
    "evil.com/x",
    "evil.com#x",
    "evil.com?x",
    "a@b",
    "a b",
    "sub.domain",
    "-leading",
    "trailing-",
    "with_underscore",
    "a".repeat(64),
    "",
  ])("rejects the malformed slug %j", (slug) => {
    expect(agentIngressBaseUrl(slug, "us")).toBeNull();
    expect(agentIngressBaseUrl(slug, "dev")).toBeNull();
  });
});
