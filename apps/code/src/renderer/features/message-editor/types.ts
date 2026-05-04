import type { AvailableCommand } from "@agentclientprotocol/sdk";
import type { GithubRefKind, GithubRefState } from "@main/services/git/schemas";
import type {
  EditorContent,
  FileAttachment,
  MentionChip,
} from "./utils/content";

export type GithubIssueState = GithubRefState;
export type { GithubRefKind, GithubRefState };

export interface EditorHandle {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  isEmpty: () => boolean;
  getContent: () => EditorContent;
  getText: () => string;
  setContent: (text: string) => void;
  insertChip: (chip: MentionChip) => void;
  removeChipById: (chipId: string) => void;
  replaceChipAttrs: (
    chipId: string,
    attrs: Partial<{ id: string; label: string; type: MentionChip["type"] }>,
  ) => void;
  addAttachment: (attachment: FileAttachment) => void;
  removeAttachment: (id: string) => void;
}

export interface SuggestionItem {
  id: string;
  label: string;
  description?: string;
  filename?: string;
  chipType?: MentionChip["type"];
}

export interface FileSuggestionItem extends SuggestionItem {
  path: string;
  kind?: "file" | "directory";
}

export interface CommandSuggestionItem extends SuggestionItem {
  command: AvailableCommand;
}

export interface IssueSuggestionItem extends SuggestionItem {
  kind: GithubRefKind;
  number: number;
  title: string;
  url: string;
  repo: string;
  state: GithubRefState;
  labels: string[];
  isDraft?: boolean;
}

export type SuggestionLoadingState = "idle" | "loading" | "error" | "success";

export interface SuggestionPosition {
  x: number;
  y: number;
}
