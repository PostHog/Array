import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MentionChipView } from "./MentionChipView";

export type ChipType =
  | "file"
  | "folder"
  | "command"
  | "error"
  | "experiment"
  | "insight"
  | "feature_flag"
  | "github_issue"
  | "github_pr";

export interface MentionChipAttrs {
  type: ChipType;
  id: string;
  label: string;
  pastedText: boolean;
  /** Optional unique handle so callers can later replace or remove this chip. */
  chipId?: string | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mentionChip: {
      insertMentionChip: (attrs: MentionChipAttrs) => ReturnType;
      replaceMentionChipById: (
        chipId: string,
        attrs: Partial<MentionChipAttrs>,
      ) => ReturnType;
      removeMentionChipById: (chipId: string) => ReturnType;
    };
  }
}

export const MentionChipNode = Node.create({
  name: "mentionChip",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      type: { default: "file" as ChipType },
      id: { default: "" },
      label: { default: "" },
      pastedText: { default: false },
      chipId: { default: null as string | null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention-chip="true"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { type, label } = node.attrs as MentionChipAttrs;
    const isCommand = type === "command";
    const prefix = isCommand ? "/" : "@";

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-mention-chip": "true",
        "data-chip-type": type,
        "data-chip-id": node.attrs.id,
        "data-chip-label": label,
        class: `${isCommand ? "cli-slash-command" : "cli-file-mention"} inline select-all cursor-default rounded-[var(--radius-1)] bg-[var(--accent-a3)] px-1 py-px text-xs font-medium text-[var(--accent-11)]`,
        contenteditable: "false",
      }),
      `${prefix}${label}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView, {
      contentDOMElementTag: "span",
    });
  },

  addCommands() {
    return {
      insertMentionChip:
        (attrs: MentionChipAttrs) =>
        ({ chain }) => {
          return chain()
            .insertContent([
              { type: this.name, attrs },
              { type: "text", text: " " },
            ])
            .run();
        },
      replaceMentionChipById:
        (chipId: string, attrs: Partial<MentionChipAttrs>) =>
        ({ tr, state, dispatch }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (found) return false;
            if (node.type.name !== "mentionChip") return;
            if (node.attrs.chipId !== chipId) return;
            found = true;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
            return false;
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
      removeMentionChipById:
        (chipId: string) =>
        ({ tr, state, dispatch }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (found) return false;
            if (node.type.name !== "mentionChip") return;
            if (node.attrs.chipId !== chipId) return;
            found = true;
            const from = pos;
            const to = pos + node.nodeSize;
            // Also swallow a trailing single space the suggestion adds.
            const after = state.doc.textBetween(
              to,
              Math.min(to + 1, state.doc.content.size),
            );
            tr.delete(from, after === " " ? to + 1 : to);
            return false;
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },
});
