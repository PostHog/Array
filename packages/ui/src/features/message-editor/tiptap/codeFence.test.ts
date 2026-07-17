import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { convertFenceLine, findCodeFenceLine } from "./codeFence";
import { getEditorExtensions } from "./extensions";

let editor: Editor;

function buildEditor(content: string) {
  editor = new Editor({
    extensions: getEditorExtensions({
      sessionId: "test-session",
      fileMentions: false,
      issueMentions: false,
      commands: false,
      codeBlocks: true,
    }),
    content,
  });
  editor.commands.focus("end");
  return editor;
}

afterEach(() => {
  editor?.destroy();
});

describe("findCodeFenceLine", () => {
  it("matches a fence opening the paragraph", () => {
    buildEditor("<p>```js</p>");
    const fence = findCodeFenceLine(editor.view);
    expect(fence).toMatchObject({ language: "js", afterHardBreak: false });
  });

  it("matches a fence on the line after a hard break", () => {
    buildEditor("<p>some text<br>```</p>");
    const fence = findCodeFenceLine(editor.view);
    expect(fence).toMatchObject({ language: "", afterHardBreak: true });
  });

  it.each([
    { name: "text before the fence on the same line", html: "<p>text ```</p>" },
    { name: "no fence at all", html: "<p>hello</p>" },
    { name: "a quadruple backtick run", html: "<p>````</p>" },
  ])("returns null for $name", ({ html }) => {
    buildEditor(html);
    expect(findCodeFenceLine(editor.view)).toBeNull();
  });
});

describe("convertFenceLine", () => {
  it("converts a fence after a hard break into a code block after the paragraph", () => {
    buildEditor("<p>some text<br>```py</p>");

    expect(convertFenceLine(editor.view)).toBe(true);

    const json = editor.getJSON();
    expect(json.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "some text" }] },
      { type: "codeBlock", attrs: { language: "py" } },
      // StarterKit's TrailingNode keeps a paragraph after the block.
      { type: "paragraph" },
    ]);
    // Caret ends up inside the new code block.
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
  });

  it("converts a paragraph-opening fence in place", () => {
    buildEditor("<p>```js</p>");

    expect(convertFenceLine(editor.view)).toBe(true);

    expect(editor.getJSON().content).toEqual([
      { type: "codeBlock", attrs: { language: "js" } },
      { type: "paragraph" },
    ]);
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
  });

  it("does nothing when the line is not a fence", () => {
    buildEditor("<p>text ```</p>");
    expect(convertFenceLine(editor.view)).toBe(false);
  });
});

describe("space after ```", () => {
  it("does not create a code block (Enter is the only trigger)", () => {
    buildEditor("<p>```</p>");
    const { view } = editor;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, view.state.selection.from, view.state.selection.to, " ", () =>
        view.state.tr.insertText(" "),
      ),
    );
    expect(handled ?? false).toBe(false);
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
  });
});
