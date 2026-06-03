import { describe, expect, it } from "vitest";
import { classifyPostHogSubTool, POSTHOG_PRODUCTS } from "./posthog-products";

describe("classifyPostHogSubTool", () => {
  it("maps resource sub-tools to their product", () => {
    expect(classifyPostHogSubTool("experiment-list")).toBe("experiments");
    expect(classifyPostHogSubTool("feature-flag-update")).toBe("feature_flags");
    expect(classifyPostHogSubTool("early-access-feature-create")).toBe(
      "feature_flags",
    );
    expect(classifyPostHogSubTool("error-tracking-issue-update")).toBe(
      "error_tracking",
    );
    expect(classifyPostHogSubTool("session-recording-get")).toBe(
      "session_replay",
    );
    expect(classifyPostHogSubTool("survey-create")).toBe("surveys");
    expect(classifyPostHogSubTool("execute-sql")).toBe("sql");
    expect(classifyPostHogSubTool("external-data-sources-list")).toBe(
      "data_warehouse",
    );
    expect(classifyPostHogSubTool("cdp-functions-list")).toBe("cdp");
    expect(classifyPostHogSubTool("insight-create")).toBe("product_analytics");
  });

  it("classifies query-* sub-tools by query type", () => {
    expect(classifyPostHogSubTool("query-trends")).toBe("product_analytics");
    expect(classifyPostHogSubTool("query-trends-actors")).toBe(
      "product_analytics",
    );
    expect(classifyPostHogSubTool("query-paths")).toBe("product_analytics");
    expect(classifyPostHogSubTool("query-error-tracking-issues-list")).toBe(
      "error_tracking",
    );
    expect(classifyPostHogSubTool("query-session-recordings-list")).toBe(
      "session_replay",
    );
    expect(classifyPostHogSubTool("query-llm-traces-list")).toBe(
      "llm_analytics",
    );
    expect(classifyPostHogSubTool("query-logs")).toBe("logs");
    expect(classifyPostHogSubTool("query-apm-spans")).toBe("apm");
  });

  it("does not let a short domain shadow a longer one", () => {
    // `llm` must not swallow the distinct `llma-*` domains.
    expect(classifyPostHogSubTool("llm-costs")).toBe("llm_analytics");
    expect(classifyPostHogSubTool("llma-personal-spend")).toBe("llm_analytics");
  });

  it("returns null for admin/meta/introspection domains", () => {
    expect(classifyPostHogSubTool("project-get")).toBeNull();
    expect(classifyPostHogSubTool("activity-log-list")).toBeNull();
    expect(classifyPostHogSubTool("docs-search")).toBeNull();
    expect(classifyPostHogSubTool("tasks-list")).toBeNull();
  });

  it("falls back to the generic product for unrecognized domains", () => {
    expect(classifyPostHogSubTool("brand-new-thing-list")).toBe("posthog");
  });

  it("returns null for empty input", () => {
    expect(classifyPostHogSubTool("")).toBeNull();
    expect(classifyPostHogSubTool("   ")).toBeNull();
  });

  it("only emits ids that exist in POSTHOG_PRODUCTS", () => {
    const ids = [
      "experiment-list",
      "query-trends",
      "execute-sql",
      "brand-new-thing-list",
    ]
      .map(classifyPostHogSubTool)
      .filter((id): id is NonNullable<typeof id> => id !== null);
    for (const id of ids) {
      expect(POSTHOG_PRODUCTS[id]).toBeDefined();
    }
  });
});
