import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { useAddDirectoryDialogStore } from "@features/folder-picker/stores/addDirectoryDialogStore";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS, type FeedbackType } from "@shared/types/analytics";
import type { Editor } from "@tiptap/core";
import { track } from "@utils/analytics";
import { toast } from "@utils/toast";
import type { MentionChipAttrs } from "./tiptap/MentionChipNode";

interface CommandContext {
  taskId: string;
  repoPath: string | null | undefined;
  session: {
    taskRunId?: string;
    logUrl?: string;
    events: unknown[];
  } | null;
  taskRun: { id?: string; log_url?: string } | null;
}

export interface CodeCommandInsertContext {
  editor: Editor;
  chipId: string;
  sessionId: string;
}

interface CodeCommand {
  name: string;
  description: string;
  input?: { hint: string };
  /** Optional override for the chip attrs inserted when this command is committed. */
  placeholderChip?: Partial<MentionChipAttrs>;
  /** Fires immediately after the chip is inserted into the editor. */
  onInsert?: (ctx: CodeCommandInsertContext) => void;
  /** Runs at submission time when the message is sent. Optional. */
  execute?: (
    args: string | undefined,
    context: CommandContext,
  ) => Promise<void> | void;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function makeFeedbackCommand(
  name: string,
  feedbackType: FeedbackType,
  label: string,
): CodeCommand {
  return {
    name,
    description: `Capture ${label.toLowerCase()} feedback`,
    input: { hint: "optional comment" },
    execute(args, ctx) {
      track(ANALYTICS_EVENTS.TASK_FEEDBACK, {
        task_id: ctx.taskId,
        task_run_id: ctx.session?.taskRunId ?? ctx.taskRun?.id,
        log_url: ctx.session?.logUrl ?? ctx.taskRun?.log_url,
        event_count: ctx.session?.events.length ?? 0,
        feedback_type: feedbackType,
        feedback_comment: args?.trim() || undefined,
      });
      toast.success(`${label} feedback captured`);
    },
  };
}

const addDirCommand: CodeCommand = {
  name: "add-dir",
  description: "Add a folder the agent can access in this task",
  async onInsert(ctx) {
    const taskId = ctx.sessionId;
    try {
      const path = await trpcClient.os.selectDirectory.query();
      if (!path) {
        ctx.editor.commands.removeMentionChipById(ctx.chipId);
        return;
      }
      ctx.editor.commands.replaceMentionChipById(ctx.chipId, {
        id: path,
        label: `add-dir - ${basename(path)}`,
      });
      useAddDirectoryDialogStore.getState().show({
        taskId,
        path,
        onCancel: () => ctx.editor.commands.removeMentionChipById(ctx.chipId),
      });
    } catch (err) {
      ctx.editor.commands.removeMentionChipById(ctx.chipId);
      toast.error("Failed to open folder picker", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

const commands: CodeCommand[] = [
  addDirCommand,
  makeFeedbackCommand("good", "good", "Positive"),
  makeFeedbackCommand("bad", "bad", "Negative"),
  makeFeedbackCommand("feedback", "general", "General"),
];

export const CODE_COMMANDS: AvailableCommand[] = commands.map((cmd) => ({
  name: cmd.name,
  description: cmd.description,
  input: cmd.input,
}));

const commandMap = new Map(commands.map((cmd) => [cmd.name, cmd]));

export function getCodeCommand(name: string): CodeCommand | undefined {
  return commandMap.get(name);
}

export async function tryExecuteCodeCommand(
  text: string,
  context: CommandContext,
): Promise<boolean> {
  const match = text.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!match) return false;

  const cmd = commandMap.get(match[1]);
  if (!cmd?.execute) return false;

  await cmd.execute(match[2], context);
  return true;
}
