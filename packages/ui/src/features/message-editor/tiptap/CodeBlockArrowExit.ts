import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Escape hatch for a fenced code block sitting at the very top of the doc:
 * ArrowUp on the block's first line inserts an empty paragraph above and
 * moves the caret there. Mirrors CodeBlock's built-in `exitOnArrowDown`,
 * which Tiptap ships no upward counterpart for.
 */
export const CodeBlockArrowExit = Extension.create({
  name: "codeBlockArrowExit",

  addKeyboardShortcuts() {
    return {
      ArrowUp: ({ editor }) => {
        const { selection, schema } = editor.state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parent.type.name !== "codeBlock") return false;
        // Only when the block is the doc's first child and the caret is on
        // the first visual line, so plain in-block navigation still works.
        if ($from.index(0) !== 0) return false;
        if (!editor.view.endOfTextblock("up")) return false;

        const paragraph = schema.nodes.paragraph.createAndFill();
        if (!paragraph) return false;

        return editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) {
            tr.insert(0, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, 1));
            tr.scrollIntoView();
          }
          return true;
        });
      },
    };
  },
});
