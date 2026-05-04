import { getCodeCommand } from "@features/message-editor/commands";
import { getCommandSuggestions } from "../suggestions/getSuggestions";
import { createSuggestionMention } from "./createSuggestionMention";

export interface CommandMentionOptions {
  sessionId: string;
}

export function createCommandMention(options: CommandMentionOptions) {
  const { sessionId } = options;

  return createSuggestionMention({
    name: "commandMention",
    char: "/",
    chipType: "command",
    startOfLine: true,
    autoCommit: true,
    items: (query) =>
      sessionId ? getCommandSuggestions(sessionId, query) : [],
    resolveChipAttrs: (item) => {
      const cmd = getCodeCommand(item.label);
      return cmd?.placeholderChip ?? {};
    },
    onAfterInsert: (item, ctx) => {
      const cmd = getCodeCommand(item.label);
      cmd?.onInsert?.({
        editor: ctx.editor,
        chipId: ctx.chipId,
        sessionId,
      });
    },
  });
}
