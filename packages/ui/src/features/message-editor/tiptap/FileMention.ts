import { getFileSuggestions } from "../suggestions/getSuggestions";
import { createSuggestionMention } from "./createSuggestionMention";

export function createFileMention(sessionId: string) {
  return createSuggestionMention({
    name: "fileMention",
    char: "@",
    chipType: "file",
    items: (query) => (sessionId ? getFileSuggestions(sessionId, query) : []),
  });
}
