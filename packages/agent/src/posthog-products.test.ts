import { describe, expect, it } from "vitest";
import {
  classifyPostHogExecCall,
  classifyPostHogSqlQuery,
  classifyPostHogSubTool,
  POSTHOG_PRODUCTS,
} from "./posthog-products";

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

describe("classifyPostHogSqlQuery", () => {
  it("attributes a query to the product behind its tables", () => {
    expect(
      classifyPostHogSqlQuery("SELECT count() FROM feature_flags"),
    ).toEqual(["feature_flags"]);
    expect(classifyPostHogSqlQuery("select * from experiments")).toEqual([
      "experiments",
    ]);
    expect(classifyPostHogSqlQuery("SELECT * FROM events LIMIT 10")).toEqual([
      "product_analytics",
    ]);
  });

  it("resolves a schema-qualified table by its bare name", () => {
    expect(
      classifyPostHogSqlQuery("SELECT count() FROM system.feature_flags"),
    ).toEqual(["feature_flags"]);
  });

  it("handles quoted/back-ticked identifiers", () => {
    expect(classifyPostHogSqlQuery("SELECT * FROM `feature_flags`")).toEqual([
      "feature_flags",
    ]);
  });

  it("collects products across joins, deduped", () => {
    const products = classifyPostHogSqlQuery(
      "SELECT * FROM events e JOIN persons p ON e.person_id = p.id JOIN feature_flags f ON true",
    );
    expect(products).toContain("product_analytics");
    expect(products).toContain("feature_flags");
    // events + persons both map to product_analytics — deduped to one entry.
    expect(products.filter((p) => p === "product_analytics")).toHaveLength(1);
  });

  it("returns nothing when no referenced table maps", () => {
    expect(classifyPostHogSqlQuery("SELECT 1")).toEqual([]);
    expect(
      classifyPostHogSqlQuery("SELECT * FROM some_warehouse_table"),
    ).toEqual([]);
  });

  it("does not match warehouse tables that merely contain a product name", () => {
    // Exact-name match only — a similarly-named warehouse table is left alone.
    expect(
      classifyPostHogSqlQuery("SELECT * FROM statsig_feature_flags"),
    ).toEqual([]);
    expect(
      classifyPostHogSqlQuery("SELECT * FROM feature_flags_archive"),
    ).toEqual([]);
  });

  it("does not match a warehouse table qualified with a non-PostHog schema", () => {
    // `stripe.feature_flags` is a warehouse table, not the PostHog one.
    expect(
      classifyPostHogSqlQuery("SELECT * FROM stripe.feature_flags"),
    ).toEqual([]);
    expect(classifyPostHogSqlQuery("SELECT * FROM my_source.events")).toEqual(
      [],
    );
  });
});

describe("classifyPostHogExecCall", () => {
  it("attributes execute-sql to the queried product, not generic SQL", () => {
    expect(
      classifyPostHogExecCall(
        "execute-sql",
        'call execute-sql {"query":"SELECT count() FROM feature_flags"}',
      ),
    ).toEqual(["feature_flags"]);
  });

  it("falls back to the sql product when no table maps", () => {
    expect(
      classifyPostHogExecCall(
        "execute-sql",
        'call execute-sql {"query":"SELECT 1"}',
      ),
    ).toEqual(["sql"]);
    // No command text at all → still surfaces something rather than vanishing.
    expect(classifyPostHogExecCall("execute-sql")).toEqual(["sql"]);
  });

  it("delegates non-sql sub-tools to the domain classifier", () => {
    expect(classifyPostHogExecCall("feature-flag-list")).toEqual([
      "feature_flags",
    ]);
    expect(classifyPostHogExecCall("experiment-get")).toEqual(["experiments"]);
  });

  it("returns an empty array for admin/meta sub-tools", () => {
    expect(classifyPostHogExecCall("project-get")).toEqual([]);
  });
});
