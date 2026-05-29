import {
  githubIssueToMentionChip,
  githubPullRequestToMentionChip,
} from "@posthog/core/message-editor/githubIssueChip";
import {
  getAbsolutePathSuggestion,
  mergeCommands,
  searchCommands,
  shapeCommandSuggestions,
  shapeFileSuggestions,
} from "@posthog/core/message-editor/suggestions";
import { getAvailableCommandsForTask } from "@posthog/ui/features/sessions/sessionStore";
import { fetchRepoFiles, searchFiles } from "../../repo-files/useRepoFiles";
import { CODE_COMMANDS } from "../commands";
import { useDraftStore } from "../draftStore";
import { searchGithubRefs } from "../hostApi";
import type {
  CommandSuggestionItem,
  FileSuggestionItem,
  IssueSuggestionItem,
} from "../types";

export async function getFileSuggestions(
  sessionId: string,
  query: string,
): Promise<FileSuggestionItem[]> {
  const repoPath = useDraftStore.getState().contexts[sessionId]?.repoPath;
  const absoluteMatch = getAbsolutePathSuggestion(query);

  if (!repoPath) {
    return absoluteMatch ? [absoluteMatch] : [];
  }

  const { files, fzf } = await fetchRepoFiles(repoPath, {
    includeDirectories: true,
  });
  const matched = searchFiles(fzf, files, query);

  return shapeFileSuggestions(matched, repoPath, absoluteMatch);
}

export async function getIssueSuggestions(
  sessionId: string,
  query: string,
): Promise<IssueSuggestionItem[]> {
  const repoPath = useDraftStore.getState().contexts[sessionId]?.repoPath;
  if (!repoPath) return [];

  try {
    const refs = await searchGithubRefs({
      directoryPath: repoPath,
      query: query || undefined,
      limit: 25,
    });

    return refs.map((ref) => {
      const chip =
        ref.kind === "pr"
          ? githubPullRequestToMentionChip(ref)
          : githubIssueToMentionChip(ref);
      return {
        id: chip.id,
        label: chip.label,
        chipType: chip.type,
        kind: ref.kind,
        number: ref.number,
        title: ref.title,
        url: ref.url,
        repo: ref.repo,
        state: ref.state,
        labels: ref.labels,
        isDraft: ref.isDraft,
      };
    });
  } catch {
    return [];
  }
}

export function getCommandSuggestions(
  sessionId: string,
  query: string,
): CommandSuggestionItem[] {
  const store = useDraftStore.getState();
  const taskId = store.contexts[sessionId]?.taskId;
  const agentCommands = taskId
    ? getAvailableCommandsForTask(taskId)
    : (store.commands[sessionId] ?? []);
  const commands = mergeCommands(CODE_COMMANDS, agentCommands);
  const filtered = searchCommands(commands, query);

  return shapeCommandSuggestions(filtered);
}
