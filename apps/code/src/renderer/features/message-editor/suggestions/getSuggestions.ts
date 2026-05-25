import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { CODE_COMMANDS } from "@features/message-editor/commands";
import { getAvailableCommandsForTask } from "@features/sessions/stores/sessionStore";
import {
  fetchRepoFiles,
  pathToFileItem,
  searchFiles,
} from "@hooks/useRepoFiles";
import { trpc } from "@renderer/trpc/client";
import { isAbsolutePath } from "@utils/path";
import { queryClient } from "@utils/queryClient";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useDraftStore } from "../stores/draftStore";
import type {
  CommandSuggestionItem,
  FileSuggestionItem,
  IssueSuggestionItem,
} from "../types";
import {
  githubIssueToMentionChip,
  githubPullRequestToMentionChip,
} from "../utils/githubIssueChip";

const COMMAND_FUSE_OPTIONS: IFuseOptions<AvailableCommand> = {
  keys: [
    { name: "name", weight: 0.7 },
    { name: "description", weight: 0.3 },
  ],
  threshold: 0.3,
  includeScore: true,
};

function searchCommands(
  commands: AvailableCommand[],
  query: string,
): AvailableCommand[] {
  if (!query.trim()) {
    return commands;
  }

  const fuse = new Fuse(commands, COMMAND_FUSE_OPTIONS);
  const results = fuse.search(query);

  const lowerQuery = query.toLowerCase();
  results.sort((a, b) => {
    const aStartsWithQuery = a.item.name.toLowerCase().startsWith(lowerQuery);
    const bStartsWithQuery = b.item.name.toLowerCase().startsWith(lowerQuery);

    if (aStartsWithQuery && !bStartsWithQuery) return -1;
    if (!aStartsWithQuery && bStartsWithQuery) return 1;
    return (a.score ?? 0) - (b.score ?? 0);
  });

  return results.map((result) => result.item);
}

function parentDirLabel(dir: string, name: string): string {
  const parent = dir.split("/").filter(Boolean).pop();
  return parent ? `${parent}/${name}` : name;
}

function getAbsolutePathSuggestion(query: string): FileSuggestionItem | null {
  if (!isAbsolutePath(query)) return null;
  if (!/\.\w+$/.test(query)) return null;

  const fileItem = pathToFileItem(query);
  return {
    id: query,
    label: parentDirLabel(fileItem.dir, fileItem.name),
    description: fileItem.dir || undefined,
    filename: fileItem.name,
    path: query,
  };
}

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

  const results: FileSuggestionItem[] = matched.map((file) => {
    const isDirectory = file.kind === "directory";
    return {
      id: file.path,
      label: parentDirLabel(file.dir, file.name),
      description: file.dir || undefined,
      filename: file.name,
      path: file.path,
      kind: file.kind,
      chipType: isDirectory ? "folder" : "file",
    };
  });

  if (
    absoluteMatch &&
    !results.some((r) => `${repoPath}/${r.id}` === absoluteMatch.id)
  ) {
    results.unshift(absoluteMatch);
  }

  return results;
}

export async function getIssueSuggestions(
  sessionId: string,
  query: string,
): Promise<IssueSuggestionItem[]> {
  const repoPath = useDraftStore.getState().contexts[sessionId]?.repoPath;
  if (!repoPath) return [];

  try {
    const refs = await queryClient.fetchQuery({
      ...trpc.git.searchGithubRefs.queryOptions({
        directoryPath: repoPath,
        query: query || undefined,
        limit: 25,
      }),
      staleTime: 30_000,
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
  // Agent commands (from `available_commands_update`) are authoritative once a
  // session has reported them, but they arrive async after session startup —
  // fall back to the trpc-fetched skills list so users don't see only the
  // built-in /good /bad /feedback commands during that window. `null` means
  // "agent hasn't reported yet"; an empty array means "agent reported empty"
  // and we respect it.
  const sessionCommands = taskId ? getAvailableCommandsForTask(taskId) : null;
  const draftCommands = store.commands[sessionId] ?? [];
  const agentCommands = sessionCommands ?? draftCommands;
  const merged = [...CODE_COMMANDS, ...agentCommands];
  const commands = [...new Map(merged.map((cmd) => [cmd.name, cmd])).values()];
  const filtered = searchCommands(commands, query);

  return filtered.map((cmd) => ({
    id: cmd.name,
    label: cmd.name,
    description: cmd.description,
    command: cmd,
  }));
}
