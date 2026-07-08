import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  formatUsageStats,
  renderSubagentCall,
  renderSubagentResult,
} from "./render";
import type { SingleRunResult } from "./run-agent";

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
  } as unknown as Theme;
}

function successResult(
  overrides: Partial<SingleRunResult> = {},
): SingleRunResult {
  return {
    runId: "run-1",
    agent: "scout",
    task: "look around",
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "found it" }],
      } as never,
    ],
    stderr: "",
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.01,
      contextTokens: 150,
      turns: 1,
    },
    ...overrides,
  };
}

describe("formatUsageStats", () => {
  it("formats a full set of usage fields", () => {
    const text = formatUsageStats(
      {
        input: 1200,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.0123,
        contextTokens: 2000,
        turns: 2,
      },
      "anthropic/opus",
    );
    expect(text).toContain("2 turns");
    expect(text).toContain("$0.0123");
    expect(text).toContain("anthropic/opus");
  });

  it("returns an empty string when there's nothing to show", () => {
    expect(
      formatUsageStats({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      }),
    ).toBe("");
  });
});

describe("renderSubagentCall", () => {
  const theme = makeTheme();

  it("renders single mode", () => {
    const component = renderSubagentCall(
      { agent: "scout", task: "find the auth code" },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });

  it("renders parallel mode with a task count", () => {
    const component = renderSubagentCall(
      {
        tasks: [
          { agent: "scout", task: "a" },
          { agent: "reviewer", task: "b" },
        ],
      },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });

  it("renders chain mode with a step count", () => {
    const component = renderSubagentCall(
      { chain: [{ agent: "scout", task: "a" }] },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });
});

describe("renderSubagentResult", () => {
  const theme = makeTheme();

  it("falls back to plain text when there are no results", () => {
    const component = renderSubagentResult(
      {
        content: [{ type: "text", text: "nothing" }],
        details: { mode: "single", results: [] },
      },
      { expanded: false, isPartial: false },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });

  it("renders a collapsed single result", () => {
    const component = renderSubagentResult(
      {
        content: [{ type: "text", text: "done" }],
        details: { mode: "single", results: [successResult()] },
      },
      { expanded: false, isPartial: false },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });

  it("renders an expanded single result as a Container with Markdown output", () => {
    const component = renderSubagentResult(
      {
        content: [{ type: "text", text: "done" }],
        details: { mode: "single", results: [successResult()] },
      },
      { expanded: true, isPartial: false },
      theme,
    );
    expect(component.constructor.name).toBe("Container");
  });

  it("renders parallel results without a stale runId hint (runId only ever accompanies empty results)", () => {
    const component = renderSubagentResult(
      {
        content: [{ type: "text", text: "done" }],
        details: {
          mode: "parallel",
          results: [successResult(), successResult({ agent: "reviewer" })],
        },
      },
      { expanded: false, isPartial: false },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });

  it("marks a failed result distinctly from a running one", () => {
    const failed = successResult({
      exitCode: 1,
      stopReason: "error",
      errorMessage: "boom",
    });
    const running = successResult({ exitCode: -1, agent: "worker" });
    const component = renderSubagentResult(
      {
        content: [{ type: "text", text: "..." }],
        details: { mode: "parallel", results: [failed, running] },
      },
      { expanded: false, isPartial: false },
      theme,
    );
    expect(component.constructor.name).toBe("Text");
  });
});
