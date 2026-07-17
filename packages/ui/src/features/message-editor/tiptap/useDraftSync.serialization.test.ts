import type { EditorContent } from "@posthog/core/message-editor/content";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/shell/rendererStorage", () => ({
  electronStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

import {
  editorContentToTiptapJson,
  tiptapJsonToEditorContent,
} from "./useDraftSync";

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function p(...content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}

function text(value: string): JSONContent {
  return { type: "text", text: value };
}

function code(value: string): JSONContent {
  return { type: "text", text: value, marks: [{ type: "code" }] };
}

function codeBlock(
  content: string,
  language: string | null = null,
): JSONContent {
  return {
    type: "codeBlock",
    attrs: { language },
    content: content ? [{ type: "text", text: content }] : undefined,
  };
}

function toText(content: EditorContent): string {
  return content.segments
    .map((seg) => (seg.type === "text" ? seg.text : `@${seg.chip.label}`))
    .join("");
}

describe("tiptapJsonToEditorContent", () => {
  it.each([
    {
      name: "wraps an inline code mark in backticks",
      json: doc(p(text("run "), code("pnpm dev"), text(" now"))),
      expected: "run `pnpm dev` now",
    },
    {
      name: "merges adjacent code-marked text nodes into one span",
      json: doc(p(code("pnpm"), code(" dev"))),
      expected: "`pnpm dev`",
    },
    {
      name: "lengthens the delimiter for code containing a backtick",
      json: doc(p(code("a`b"))),
      expected: "``a`b``",
    },
    {
      name: "pads code starting or ending with a backtick",
      json: doc(p(code("`a"))),
      expected: "`` `a ``",
    },
    {
      name: "serializes a code block as a markdown fence",
      json: doc(codeBlock("const x = 1;\nconst y = 2;")),
      expected: "```\nconst x = 1;\nconst y = 2;\n```",
    },
    {
      name: "includes the language on the fence line",
      json: doc(codeBlock("print(1)", "python")),
      expected: "```python\nprint(1)\n```",
    },
    {
      name: "preserves blank lines inside a code block",
      json: doc(codeBlock("a\n\nb")),
      expected: "```\na\n\nb\n```",
    },
    {
      name: "lengthens the fence when the code contains triple backticks",
      json: doc(codeBlock("say ```hi```")),
      expected: "````\nsay ```hi```\n````",
    },
    {
      name: "separates code blocks from paragraphs with blank lines",
      json: doc(p(text("before")), codeBlock("code", "js"), p(text("after"))),
      expected: "before\n\n```js\ncode\n```\n\nafter",
    },
  ])("$name", ({ json, expected }) => {
    expect(toText(tiptapJsonToEditorContent(json))).toBe(expected);
  });
});

describe("editorContentToTiptapJson with codeBlocks", () => {
  it.each([
    {
      name: "paragraphs around a fenced block",
      json: doc(p(text("before")), codeBlock("code", "js"), p(text("after"))),
    },
    {
      name: "a lone code block with blank lines and no trailing paragraph",
      json: doc(codeBlock("a\n\nb")),
    },
    {
      name: "inline code within a paragraph",
      json: doc(p(text("run "), code("pnpm dev"), text(" now"))),
    },
    {
      name: "a code block followed by a paragraph with inline code",
      json: doc(codeBlock("x = 1", "python"), p(text("then "), code("y"))),
    },
  ])("round-trips $name", ({ json }) => {
    const content = tiptapJsonToEditorContent(json);
    expect(editorContentToTiptapJson(content, { codeBlocks: true })).toEqual(
      json,
    );
  });

  it("keeps fences as plain text when codeBlocks is off", () => {
    const content: EditorContent = {
      segments: [{ type: "text", text: "```\ncode\n```" }],
    };
    const json = editorContentToTiptapJson(content, { codeBlocks: false });
    expect(JSON.stringify(json)).not.toContain('"codeBlock"');
    expect(JSON.stringify(json)).not.toContain('"marks"');
  });

  it("does not treat inline backtick runs as fences", () => {
    const content: EditorContent = {
      segments: [{ type: "text", text: "not a ``` fence here" }],
    };
    const json = editorContentToTiptapJson(content, { codeBlocks: true });
    expect(JSON.stringify(json)).not.toContain("codeBlock");
  });
});
