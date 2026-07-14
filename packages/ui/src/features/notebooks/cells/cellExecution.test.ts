import { describe, expect, it } from "vitest";
import {
  buildDuckSqlCode,
  buildErrorExecution,
  buildHogqlSqlAssignmentCode,
  buildMediaSource,
  buildSqlResultSummary,
  formatTraceback,
  hasHogqlPlaceholders,
  normalizeKernelExecution,
  normalizeSqlResultSummary,
  resolveReturnVariable,
  stripAnsi,
  toPositionalRows,
} from "./cellExecution";

describe("normalizeKernelExecution", () => {
  it("normalizes a wire execution dict", () => {
    const execution = normalizeKernelExecution({
      status: "ok",
      stdout: "hello\n",
      stderr: "",
      result: { "text/plain": "42" },
      media: [{ mime_type: "image/png", data: "abc123" }],
      execution_count: 3,
      error_name: null,
      traceback: [],
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:01Z",
    });
    expect(execution).toEqual({
      status: "ok",
      stdout: "hello\n",
      stderr: "",
      resultText: "42",
      media: [{ mimeType: "image/png", data: "abc123" }],
      executionCount: 3,
      errorName: null,
      traceback: [],
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:01Z",
    });
  });

  it("round-trips a previously normalized (persisted) execution", () => {
    const first = normalizeKernelExecution({
      status: "error",
      stdout: "",
      stderr: "boom",
      error_name: "ValueError",
      traceback: ["Traceback", "ValueError: boom"],
    });
    expect(normalizeKernelExecution(first)).toEqual(first);
  });

  it.each([
    [null, null],
    ["nope", null],
    [[1, 2], null],
  ])("returns null for non-object input %j", (input, expected) => {
    expect(normalizeKernelExecution(input)).toBe(expected);
  });

  it("suppresses the text result when the result is image-only", () => {
    const execution = normalizeKernelExecution({
      status: "ok",
      result: { "image/png": "abc" },
    });
    expect(execution?.resultText).toBeNull();
  });

  it("treats unknown statuses as error", () => {
    expect(normalizeKernelExecution({ status: "wat" })?.status).toBe("error");
  });
});

describe("buildErrorExecution", () => {
  it("wraps a message into an error-shaped execution", () => {
    const execution = buildErrorExecution("network down");
    expect(execution.status).toBe("error");
    expect(execution.errorName).toBe("RuntimeError");
    expect(execution.traceback).toEqual(["network down"]);
  });
});

describe("stripAnsi / formatTraceback", () => {
  it("strips ANSI color escapes", () => {
    expect(stripAnsi("\u001b[0;31mValueError\u001b[0m: boom")).toBe(
      "ValueError: boom",
    );
  });

  it("joins traceback lines and strips escapes", () => {
    expect(formatTraceback(["\u001b[1mTraceback\u001b[0m", "boom"])).toBe(
      "Traceback\nboom",
    );
  });
});

describe("buildMediaSource", () => {
  it("builds a data URI", () => {
    expect(buildMediaSource({ mimeType: "image/png", data: "abc" })).toBe(
      "data:image/png;base64,abc",
    );
  });

  it("returns null when fields are missing", () => {
    expect(buildMediaSource({ mimeType: "", data: "abc" })).toBeNull();
  });
});

describe("resolveReturnVariable", () => {
  it.each([
    ["my_df", "duck_df", "my_df"],
    ["  padded  ", "duck_df", "padded"],
    ["", "duck_df", "duck_df"],
    ["   ", "hogql_df", "hogql_df"],
    [undefined, "sql_df", "sql_df"],
    [42, "sql_df", "sql_df"],
  ])("resolves %j (fallback %s) to %s", (input, fallback, expected) => {
    expect(resolveReturnVariable(input, fallback)).toBe(expected);
  });
});

describe("buildDuckSqlCode", () => {
  it("matches the webapp's wrapper template", () => {
    expect(buildDuckSqlCode("SELECT 1", "duck_df", 10)).toBe(
      `import json\n` +
        `duck_df = duck_execute("SELECT 1")\n` +
        `duck_save_table("duck_df", duck_df)\n` +
        `json.dumps(notebook_dataframe_page(duck_df, offset=0, limit=10))`,
    );
  });

  it("escapes quotes and newlines in the SQL literal", () => {
    const code = buildDuckSqlCode('SELECT "a"\nFROM t', "df", 5);
    expect(code).toContain('duck_execute("SELECT \\"a\\"\\nFROM t")');
    expect(code).toContain("limit=5");
  });

  it("clamps the page size to at least 1 and defaults the variable", () => {
    const code = buildDuckSqlCode("SELECT 1", "  ", 0);
    expect(code).toContain("duck_df = duck_execute");
    expect(code).toContain("limit=10");
  });
});

describe("buildHogqlSqlAssignmentCode", () => {
  it("assigns hogql_execute output to the return variable", () => {
    expect(buildHogqlSqlAssignmentCode("SELECT 1", "hogql_df")).toBe(
      'hogql_df = hogql_execute("SELECT 1")',
    );
  });
});

describe("hasHogqlPlaceholders", () => {
  it.each([
    ["SELECT * FROM events WHERE x = {filters}", true],
    ["SELECT 1", false],
    ["SELECT '{not_a_placeholder}'", false],
    [`SELECT "{also_not}"`, false],
    ["SELECT '\\'{still_string}'", false],
    ["SELECT 'quoted' || {real}", true],
    ["", false],
  ])("detects placeholders in %j → %s", (code, expected) => {
    expect(hasHogqlPlaceholders(code)).toBe(expected);
  });
});

describe("toPositionalRows", () => {
  it("passes array rows through, coercing cells", () => {
    expect(toPositionalRows([[1, "a", null, { x: 1 }]], [])).toEqual([
      [1, "a", null, '{"x":1}'],
    ]);
  });

  it("orders record rows by the column list", () => {
    expect(toPositionalRows([{ b: 2, a: 1 }], ["a", "b"])).toEqual([[1, 2]]);
  });

  it("falls back to record values without columns", () => {
    expect(toPositionalRows([{ a: 1, b: 2 }], [])).toEqual([[1, 2]]);
  });

  it("wraps scalar rows", () => {
    expect(toPositionalRows([7], ["n"])).toEqual([[7]]);
  });
});

describe("sql result summaries", () => {
  it("builds an ok summary with a capped preview", () => {
    const rows = Array.from({ length: 80 }, (_, index) => [index]);
    const summary = buildSqlResultSummary({
      columns: ["n"],
      rows,
      rowCount: 80,
    });
    expect(summary.status).toBe("ok");
    expect(summary.rows).toHaveLength(50);
    expect(summary.rowCount).toBe(80);
    expect(summary.error).toBeNull();
  });

  it("builds an error summary", () => {
    const summary = buildSqlResultSummary({
      columns: [],
      rows: [],
      rowCount: 0,
      error: "bad query",
    });
    expect(summary.status).toBe("error");
    expect(summary.error).toBe("bad query");
  });

  it("round-trips through normalizeSqlResultSummary", () => {
    const summary = buildSqlResultSummary({
      columns: ["a"],
      rows: [[1]],
      rowCount: 1,
    });
    const restored = normalizeSqlResultSummary(
      JSON.parse(JSON.stringify(summary)),
    );
    expect(restored).toEqual(summary);
  });

  it.each([[null], ["junk"], [{}]])(
    "returns null for empty/junk props %j",
    (input) => {
      expect(normalizeSqlResultSummary(input)).toBeNull();
    },
  );
});
