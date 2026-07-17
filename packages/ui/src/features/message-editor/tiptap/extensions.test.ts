import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { getEditorExtensions } from "./extensions";

function buildEditor(codeBlocks: boolean) {
  return new Editor({
    extensions: getEditorExtensions({
      sessionId: "test-session",
      fileMentions: false,
      issueMentions: false,
      commands: false,
      codeBlocks,
    }),
  });
}

describe("getEditorExtensions", () => {
  it("includes the code mark and codeBlock node when codeBlocks is on", () => {
    const editor = buildEditor(true);
    expect(editor.schema.marks.code).toBeDefined();
    expect(editor.schema.nodes.codeBlock).toBeDefined();
    editor.destroy();
  });

  it("excludes the code mark and codeBlock node when codeBlocks is off", () => {
    const editor = buildEditor(false);
    expect(editor.schema.marks.code).toBeUndefined();
    expect(editor.schema.nodes.codeBlock).toBeUndefined();
    editor.destroy();
  });
});
