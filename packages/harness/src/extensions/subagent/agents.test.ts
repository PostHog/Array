import { describe, expect, it } from "vitest";
import {
  BUNDLED_AGENTS,
  findBundledAgent,
  listBundledAgentNames,
} from "./agents";

describe("agents", () => {
  it("ships exactly the five expected bundled agents", () => {
    expect(listBundledAgentNames()).toEqual([
      "scout",
      "planner",
      "reviewer",
      "worker",
      "oracle",
    ]);
  });

  it.each(BUNDLED_AGENTS.map((agent) => [agent.name, agent] as const))(
    "%s has a non-empty description and system prompt",
    (_name, agent) => {
      expect(agent.description.length).toBeGreaterThan(0);
      expect(agent.systemPrompt.trim().length).toBeGreaterThan(0);
    },
  );

  it("findBundledAgent resolves a known agent and returns undefined for an unknown one", () => {
    expect(findBundledAgent("scout")?.name).toBe("scout");
    expect(findBundledAgent("does-not-exist")).toBeUndefined();
  });
});
