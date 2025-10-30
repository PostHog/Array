import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export function findFilePathDecorations(
  doc: Node,
  className = "file-path",
): DecorationSet {
  const decorations: Decoration[] = [];
  const regex = /@[^\s]+/g;

  doc.descendants((node: Node, pos: number) => {
    if (node.isText && node.text) {
      let match: RegExpExecArray | null = null;
      regex.lastIndex = 0;
      match = regex.exec(node.text);
      while (match !== null) {
        const from = pos + match.index;
        const to = from + match[0].length;
        decorations.push(
          Decoration.inline(from, to, {
            class: className,
          }),
        );
        match = regex.exec(node.text);
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

interface FilePathHighlightOptions {
  className?: string;
}

export const FilePathHighlight = Extension.create<FilePathHighlightOptions>({
  name: "filePathHighlight",

  addOptions() {
    return {
      className: "file-path",
    };
  },

  addProseMirrorPlugins() {
    const { className } = this.options;

    return [
      new Plugin({
        key: new PluginKey("filePathHighlight"),
        state: {
          init(_, { doc }) {
            return findFilePathDecorations(doc, className);
          },
          apply(tr, oldState) {
            return tr.docChanged
              ? findFilePathDecorations(tr.doc, className)
              : oldState;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
