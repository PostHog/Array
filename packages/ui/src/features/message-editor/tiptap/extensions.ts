import type { AnyExtension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { createCommandMention } from "./CommandMention";
import { createFileMention } from "./FileMention";
import { createIssueMention } from "./IssueMention";
import { MentionChipNode, type MentionChipOptions } from "./MentionChipNode";

export interface EditorExtensionsOptions {
  sessionId: string;
  placeholder?: string;
  fileMentions?: boolean;
  issueMentions?: boolean;
  commands?: boolean;
  getPastedText?: MentionChipOptions["getPastedText"];
  forgetPastedText?: MentionChipOptions["forgetPastedText"];
}

export function getEditorExtensions(options: EditorExtensionsOptions) {
  const {
    sessionId,
    placeholder = "",
    fileMentions = true,
    issueMentions = true,
    commands = true,
    getPastedText = () => null,
    forgetPastedText = () => {},
  } = options;

  const extensions: AnyExtension[] = [
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
      code: false,
    }),
    Placeholder.configure({ placeholder }),
    MentionChipNode.configure({ getPastedText, forgetPastedText }),
  ];

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
