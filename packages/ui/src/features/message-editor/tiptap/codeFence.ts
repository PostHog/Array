import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export function inCodeBlock(view: EditorView): boolean {
  return view.state.selection.$from.parent.type.spec.code === true;
}

interface CodeFenceLine {
  language: string;
  /** Doc position where the fence text starts, including the preceding hard break. */
  deleteFrom: number;
  /** The fence follows a Shift+Enter hard break rather than opening the paragraph. */
  afterHardBreak: boolean;
}

// Caret at the end of a paragraph whose current line (after the last hard
// break, or the whole paragraph) is a ``` fence opener.
export function findCodeFenceLine(view: EditorView): CodeFenceLine | null {
  const { $from, empty } = view.state.selection;
  if (!empty) return null;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") return null;
  if ($from.parentOffset !== parent.content.size) return null;

  let lineStartOffset = 0;
  let afterHardBreak = false;
  parent.forEach((child, offset) => {
    if (child.type.name === "hardBreak") {
      lineStartOffset = offset + child.nodeSize;
      afterHardBreak = true;
    }
  });
  // Atoms (mention chips) on the line show up as the replacement char and
  // fail the match, so a chip-bearing line is never treated as a fence.
  const lineText = parent.textBetween(
    lineStartOffset,
    parent.content.size,
    undefined,
    "￼",
  );
  const match = /^```(\w*)$/.exec(lineText);
  if (!match) return null;
  const lineStartPos = $from.start() + lineStartOffset;
  return {
    language: match[1],
    deleteFrom: afterHardBreak ? lineStartPos - 1 : lineStartPos,
    afterHardBreak,
  };
}

// Shift+Enter on a ``` fence line converts it to a code block. The stock
// input rules are disabled (they fire on "``` " with a space or Enter, and
// only match a fence that opens the paragraph), so both cases are handled
// here: a paragraph-opening fence converts in place, and a fence typed after
// a hard break strips the break + fence and opens a code block right after
// the paragraph.
export function convertFenceLine(view: EditorView): boolean {
  const fence = findCodeFenceLine(view);
  if (!fence) return false;
  const codeBlockType = view.state.schema.nodes.codeBlock;
  if (!codeBlockType) return false;
  const attrs = { language: fence.language || null };

  const { $from } = view.state.selection;
  const tr = view.state.tr.delete(fence.deleteFrom, $from.pos);

  if (fence.afterHardBreak) {
    const codeBlock = codeBlockType.createAndFill(attrs);
    if (!codeBlock) return false;
    const afterParagraph = tr.mapping.map($from.after());
    tr.insert(afterParagraph, codeBlock);
    tr.setSelection(TextSelection.create(tr.doc, afterParagraph + 1));
  } else {
    tr.setBlockType(fence.deleteFrom, fence.deleteFrom, codeBlockType, attrs);
  }

  tr.scrollIntoView();
  view.dispatch(tr);
  return true;
}
