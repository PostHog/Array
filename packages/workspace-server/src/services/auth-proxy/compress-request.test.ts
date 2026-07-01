import { describe, expect, it } from "vitest";
import {
  compressMessagesBody,
  compressToolOutput,
  isCompressionEnabled,
} from "./compress-request";

const repeat = (line: string, n: number): string =>
  Array.from({ length: n }, () => line).join("\n");

describe("compressToolOutput", () => {
  it("collapses a run of >= 8 identical lines into one plus a marker", () => {
    const out = compressToolOutput(repeat("WARN retrying", 20));
    expect(out).toBe("WARN retrying\n… [19 identical lines omitted] …");
  });

  it("collapses long blank-line runs (blank lines are identical)", () => {
    const out = compressToolOutput(`a${"\n".repeat(12)}b`);
    // 11 consecutive blanks between a and b → 1 blank + marker.
    expect(out).toBe("a\n\n… [10 identical lines omitted] …\nb");
  });

  it("leaves runs shorter than the threshold untouched", () => {
    const input = repeat("x", 7);
    expect(compressToolOutput(input)).toBe(input);
  });

  it("only collapses consecutive identical lines, not scattered ones", () => {
    const input = "a\nb\na\nb\na\nb\na\nb\na\nb";
    expect(compressToolOutput(input)).toBe(input);
  });

  it("handles multiple independent runs", () => {
    const input = `${repeat("A", 10)}\nmiddle\n${repeat("B", 9)}`;
    expect(compressToolOutput(input)).toBe(
      "A\n… [9 identical lines omitted] …\nmiddle\nB\n… [8 identical lines omitted] …",
    );
  });

  it("returns single-line and empty input unchanged", () => {
    expect(compressToolOutput("just one line")).toBe("just one line");
    expect(compressToolOutput("")).toBe("");
  });
});

describe("compressMessagesBody", () => {
  const toolResultMessage = (content: unknown) => ({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content }],
  });

  const roundTrip = (obj: unknown) =>
    JSON.parse(
      compressMessagesBody(Buffer.from(JSON.stringify(obj))).toString(),
    );

  it("compresses string tool_result content", () => {
    const body = { messages: [toolResultMessage(repeat("dup", 10))] };
    const out = roundTrip(body);
    expect(out.messages[0].content[0].content).toBe(
      "dup\n… [9 identical lines omitted] …",
    );
  });

  it("compresses text parts of array tool_result content", () => {
    const body = {
      messages: [
        toolResultMessage([
          { type: "text", text: repeat("dup", 10) },
          { type: "text", text: "kept" },
        ]),
      ],
    };
    const out = roundTrip(body);
    expect(out.messages[0].content[0].content[0].text).toBe(
      "dup\n… [9 identical lines omitted] …",
    );
    expect(out.messages[0].content[0].content[1].text).toBe("kept");
  });

  it("leaves non-tool_result blocks and the system prompt untouched", () => {
    const body = {
      system: repeat("system line", 20),
      messages: [
        { role: "user", content: [{ type: "text", text: repeat("user", 20) }] },
        { role: "assistant", content: "assistant reply" },
      ],
    };
    // Nothing compressible → same buffer returned verbatim.
    const raw = Buffer.from(JSON.stringify(body));
    expect(compressMessagesBody(raw)).toBe(raw);
  });

  it("is fail-open on non-JSON bodies", () => {
    const raw = Buffer.from("not json at all");
    expect(compressMessagesBody(raw)).toBe(raw);
  });

  it("is fail-open on JSON without a messages array", () => {
    const raw = Buffer.from(JSON.stringify({ prompt: repeat("x", 20) }));
    expect(compressMessagesBody(raw)).toBe(raw);
  });

  it("preserves prompt-cache stability: a tool_result compresses identically regardless of position", () => {
    const result = {
      type: "tool_result",
      tool_use_id: "t1",
      content: repeat("L", 30),
    };
    const asLatestTurn = { messages: [{ role: "user", content: [result] }] };
    const deepInHistory = {
      messages: [
        { role: "user", content: [result] },
        { role: "assistant", content: "ok" },
        { role: "user", content: "what next?" },
      ],
    };

    const a = roundTrip(asLatestTurn).messages[0].content[0].content;
    const b = roundTrip(deepInHistory).messages[0].content[0].content;
    expect(a).toBe(b);
  });
});

describe("isCompressionEnabled", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["FALSE", false],
    ["1", true],
    ["true", true],
    ["on", true],
  ])("POSTHOG_COMPRESS_CONTEXT=%s → %s", (value, expected) => {
    expect(isCompressionEnabled({ POSTHOG_COMPRESS_CONTEXT: value })).toBe(
      expected,
    );
  });
});
