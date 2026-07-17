import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockArrowExit } from "./CodeBlockArrowExit";
import { createCommandMention } from "./CommandMention";
import { createFileMention } from "./FileMention";
import { createIssueMention } from "./IssueMention";
import { MentionChipNode } from "./MentionChipNode";

// The stock CodeBlock input rules convert "``` " (trailing space) as well as
// Enter; the composer only creates a fence on Shift+Enter (handled in
// useTiptapEditor via convertFenceLine), so drop them entirely.
const ComposerCodeBlock = CodeBlock.extend({
  addInputRules() {
    return [];
  },
}).configure({ HTMLAttributes: { class: "composer-code-block" } });

export interface EditorExtensionsOptions {
  sessionId: string;
  placeholder?: string;
  fileMentions?: boolean;
  issueMentions?: boolean;
  commands?: boolean;
  codeBlocks?: boolean;
}

export function getEditorExtensions(options: EditorExtensionsOptions) {
  const {
    sessionId,
    placeholder = "",
    fileMentions = true,
    issueMentions = true,
    commands = true,
    codeBlocks = false,
  } = options;

  const extensions = [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
      bold: false,
      italic: false,
      strike: false,
      code: codeBlocks
        ? { HTMLAttributes: { class: "composer-inline-code" } }
        : false,
    }),
    Placeholder.configure({ placeholder }),
    MentionChipNode,
  ];

  if (codeBlocks) {
    extensions.push(ComposerCodeBlock, CodeBlockArrowExit);
  }

  if (fileMentions) {
    extensions.push(createFileMention(sessionId));
  }

  if (issueMentions) {
    extensions.push(createIssueMention(sessionId));
  }

  if (commands) {
    extensions.push(createCommandMention({ sessionId }));
  }

  return extensions;
}
