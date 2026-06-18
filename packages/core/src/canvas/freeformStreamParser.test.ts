import { describe, expect, it, vi } from "vitest";
import {
  createFreeformStreamParser,
  splitProseAndCode,
} from "./freeformStreamParser";

describe("splitProseAndCode", () => {
  it("returns all prose when there is no fence", () => {
    expect(splitProseAndCode("just talking")).toEqual({
      prose: "just talking",
      code: null,
    });
  });

  it("extracts a closed fenced block and surrounding prose", () => {
    const text = "Here you go:\n```tsx\nexport default () => null;\n```\nDone.";
    expect(splitProseAndCode(text)).toEqual({
      prose: "Here you go:\nDone.",
      code: "export default () => null;",
    });
  });

  it("surfaces partial code while still streaming (no closing fence)", () => {
    const text = "Building:\n```tsx\nexport default function App() {";
    expect(splitProseAndCode(text)).toEqual({
      prose: "Building:",
      code: "export default function App() {",
    });
  });
});

describe("createFreeformStreamParser", () => {
  it("emits prose deltas (append-only) and code snapshots (replace)", () => {
    const onProse = vi.fn();
    const onCode = vi.fn();
    const parser = createFreeformStreamParser({ onProse, onCode });

    parser.push("Sure thing.\n");
    parser.push("```tsx\nexport default function A");
    parser.push("pp() { return null; }\n```\n");
    parser.flush();

    // Prose only emitted once (no duplication across pushes).
    const prose = onProse.mock.calls.map((c) => c[0]).join("");
    expect(prose).toContain("Sure thing.");

    // Final code snapshot is the full component.
    const lastCode = onCode.mock.calls.at(-1)?.[0];
    expect(lastCode).toBe("export default function App() { return null; }");
  });

  it("does not re-emit unchanged code", () => {
    const onCode = vi.fn();
    const parser = createFreeformStreamParser({ onProse: vi.fn(), onCode });
    parser.push("```tsx\nconst x = 1;\n```");
    parser.flush();
    parser.flush();
    expect(onCode).toHaveBeenCalledTimes(1);
  });
});
