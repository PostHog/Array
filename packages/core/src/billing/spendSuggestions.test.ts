import { describe, expect, it } from "vitest";
import type {
  SpendAnalysisInputSizeRow,
  SpendAnalysisResponse,
  SpendAnalysisToolRow,
} from "./spendAnalysisTypes";
import { deriveSpendSuggestions } from "./spendSuggestions";

function makeResponse(
  overrides: Partial<SpendAnalysisResponse> = {},
): SpendAnalysisResponse {
  return {
    summary: {
      date_from: "2025-04-23T00:00:00Z",
      date_to: "2025-05-23T00:00:00Z",
      product: "posthog_code",
      total_cost_usd: 100,
      event_count: 1000,
      scoped_cost_usd: 80,
      scoped_event_count: 800,
    },
    by_product: { items: [], truncated: false },
    by_tool: { items: [], truncated: false },
    by_model: { items: [], truncated: false },
    ...overrides,
  };
}

function makeToolRow(
  overrides: Partial<SpendAnalysisToolRow>,
): SpendAnalysisToolRow {
  return {
    tool: "Bash",
    generation_count: 500,
    cost_usd: 50,
    share_of_scoped: 0.625,
    avg_input_tokens: 150_000,
    ...overrides,
  };
}

function makeInputSizeRow(
  overrides: Partial<SpendAnalysisInputSizeRow>,
): SpendAnalysisInputSizeRow {
  return {
    bucket: "<50k",
    min_input_tokens: 0,
    generation_count: 100,
    cost_usd: 10,
    share_of_scoped: 0.1,
    avg_cost_per_generation: 0.1,
    ...overrides,
  };
}

describe("deriveSpendSuggestions", () => {
  it("returns a single no-spend message when total cost is zero", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        summary: {
          date_from: "2025-04-23T00:00:00Z",
          date_to: "2025-05-23T00:00:00Z",
          product: "posthog_code",
          total_cost_usd: 0,
          event_count: 0,
          scoped_cost_usd: 0,
          scoped_event_count: 0,
        },
      }),
    );
    expect(suggestions).toEqual(["No LLM spend in the selected window."]);
  });

  // The whole point of this PR: once the backend serves honest attribution,
  // the client must use `share_attributed` and stop claiming a tool "drives"
  // the spend, which is the co-occurrence artifact we're replacing.
  it("uses share_attributed and avoids 'drives' wording when attribution is present", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_tool: {
          items: [
            makeToolRow({
              cost_attributed_usd: 36,
              share_attributed: 0.45,
            }),
          ],
          truncated: false,
        },
      }),
    );
    const toolSuggestion = suggestions.find((s) => s.startsWith("Bash"));
    expect(toolSuggestion).toContain("45%");
    expect(toolSuggestion).not.toContain("drives");
    expect(toolSuggestion).toContain("split across the tools it used");
  });

  // Guards the explicit backwards-compat requirement: an older backend that
  // hasn't shipped cost_attributed_usd/share_attributed yet must still surface
  // a top-tool suggestion, using the old share_of_scoped-based wording.
  it("falls back to share_of_scoped and 'drives' wording when attribution fields are absent", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_tool: {
          items: [makeToolRow({ share_of_scoped: 0.625 })],
          truncated: false,
        },
      }),
    );
    const toolSuggestion = suggestions.find((s) => s.startsWith("Bash"));
    expect(toolSuggestion).toContain("drives 63%");
  });

  it.each([
    ["at threshold, no suggestion", 0.35, false],
    ["above threshold, suggestion fires", 0.36, true],
  ])(
    "top-tool suggestion (attributed): %s",
    (_label, shareAttributed, expectSuggestion) => {
      const suggestions = deriveSpendSuggestions(
        makeResponse({
          by_tool: {
            items: [
              makeToolRow({
                cost_attributed_usd: shareAttributed * 80,
                share_attributed: shareAttributed,
              }),
            ],
            truncated: false,
          },
        }),
      );
      const found = suggestions.some((s) => s.startsWith("Bash"));
      expect(found).toBe(expectSuggestion);
    },
  );

  it("does not add a top-tool suggestion when the top row has a null tool", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_tool: {
          items: [
            makeToolRow({
              tool: null,
              share_attributed: 0.9,
              cost_attributed_usd: 72,
            }),
          ],
          truncated: false,
        },
      }),
    );
    expect(suggestions.join(" ")).not.toContain("was involved in");
  });

  it("surfaces the no-tool suggestion without overstating it as a driver", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_tool: {
          items: [
            makeToolRow({ tool: "Bash", share_of_scoped: 0.5 }),
            makeToolRow({ tool: null, share_of_scoped: 0.2 }),
          ],
          truncated: false,
        },
      }),
    );
    const noToolSuggestion = suggestions.find((s) => s.startsWith("20%"));
    expect(noToolSuggestion).toContain("no tool call");
    expect(noToolSuggestion).not.toContain("drives");
  });

  it("recommends trimming context when the >300k bucket exceeds the threshold", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_input_size: {
          items: [
            makeInputSizeRow({ bucket: "<50k", share_of_scoped: 0.1 }),
            makeInputSizeRow({
              bucket: ">300k",
              min_input_tokens: 300_000,
              share_of_scoped: 0.45,
            }),
          ],
          truncated: false,
        },
      }),
    );
    const contextSuggestion = suggestions.find((s) => s.includes("300k"));
    expect(contextSuggestion).toContain("45%");
    expect(contextSuggestion).toContain("clear between unrelated tasks");
  });

  // The >300k bucket can stay under the bar while spend actually clusters in
  // a smaller bucket (e.g. 200k-300k) -- the top-by-cost bucket should still
  // trigger the suggestion using its own numbers.
  it("falls back to the top-by-cost bucket when >300k is under threshold", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_input_size: {
          items: [
            makeInputSizeRow({ bucket: "<50k", share_of_scoped: 0.1 }),
            makeInputSizeRow({
              bucket: "200k-300k",
              min_input_tokens: 200_000,
              share_of_scoped: 0.5,
            }),
            makeInputSizeRow({
              bucket: ">300k",
              min_input_tokens: 300_000,
              share_of_scoped: 0.2,
            }),
          ],
          truncated: false,
        },
      }),
    );
    const contextSuggestion = suggestions.find((s) =>
      s.includes("200k+ input tokens"),
    );
    expect(contextSuggestion).toContain("50%");
  });

  it("adds no context-size suggestion when every bucket is under threshold", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_input_size: {
          items: [
            makeInputSizeRow({ bucket: "<50k", share_of_scoped: 0.3 }),
            makeInputSizeRow({
              bucket: ">300k",
              min_input_tokens: 300_000,
              share_of_scoped: 0.3,
            }),
          ],
          truncated: false,
        },
      }),
    );
    expect(
      suggestions.some((s) => s.includes("clear between unrelated tasks")),
    ).toBe(false);
  });

  it("adds no context-size suggestion when by_input_size is absent", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        by_tool: {
          items: [makeToolRow({ share_of_scoped: 0.5 })],
          truncated: false,
        },
      }),
    );
    expect(
      suggestions.some((s) => s.includes("clear between unrelated tasks")),
    ).toBe(false);
  });

  it("keeps the codeShare suggestion when this app dominates total spend", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        summary: {
          date_from: "2025-04-23T00:00:00Z",
          date_to: "2025-05-23T00:00:00Z",
          product: "posthog_code",
          total_cost_usd: 100,
          event_count: 1000,
          scoped_cost_usd: 90,
          scoped_event_count: 900,
        },
      }),
    );
    expect(suggestions[0]).toContain("90% of your spend");
  });

  it("falls back to the generic message when no other suggestion fires", () => {
    const suggestions = deriveSpendSuggestions(
      makeResponse({
        summary: {
          date_from: "2025-04-23T00:00:00Z",
          date_to: "2025-05-23T00:00:00Z",
          product: "posthog_code",
          total_cost_usd: 100,
          event_count: 1000,
          scoped_cost_usd: 50,
          scoped_event_count: 500,
        },
      }),
    );
    expect(suggestions).toEqual([
      "Your spend is fairly evenly distributed across tools. No single hotspot stands out.",
    ]);
  });
});
