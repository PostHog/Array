import { describe, expect, it } from "vitest";
import { serializeError, summarizeError } from "./errorDetails";

describe("serializeError", () => {
  it("pretty-prints plain objects", () => {
    expect(serializeError({ code: 500, message: "boom" })).toBe(
      JSON.stringify({ code: 500, message: "boom" }, null, 2),
    );
  });

  it("expands Error instances with message, stack, and enumerable extras", () => {
    const err = Object.assign(new Error("kaput"), { code: "ECONNRESET" });
    const parsed = JSON.parse(serializeError(err));
    expect(parsed.name).toBe("Error");
    expect(parsed.message).toBe("kaput");
    expect(parsed.code).toBe("ECONNRESET");
    expect(typeof parsed.stack).toBe("string");
  });

  it("elides circular references instead of throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const parsed = JSON.parse(serializeError(obj));
    expect(parsed.self).toBe("[circular]");
  });

  it("falls back to String() for values JSON cannot represent", () => {
    expect(serializeError(undefined)).toBe("undefined");
  });
});

describe("summarizeError", () => {
  it.each([
    ["a string error", "it broke", "it broke"],
    ["an Error's message", new Error("nope"), "nope"],
    ["a message-bearing object", { message: "denied", code: 403 }, "denied"],
  ])("uses %s", (_label, input, expected) => {
    expect(summarizeError(input)).toBe(expected);
  });

  it("flattens whitespace and truncates long messages with an ellipsis", () => {
    const summary = summarizeError(`x  y\n${"z".repeat(300)}`);
    expect(summary.startsWith("x y z")).toBe(true);
    expect(summary.length).toBe(141);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("stringifies messageless payloads", () => {
    expect(summarizeError({ status: 502 })).toBe('{ "status": 502 }');
  });

  it("never returns an empty summary", () => {
    expect(summarizeError("   ")).toBe("Unknown error");
  });
});
