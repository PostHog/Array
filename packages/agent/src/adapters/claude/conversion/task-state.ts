import type { PlanEntry } from "@agentclientprotocol/sdk";
import type {
  TaskCreateInput,
  TaskCreateOutput,
  TaskUpdateInput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools.js";

export type TaskEntry = {
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  description?: string;
};

export type TaskState = Map<string, TaskEntry>;

export function parseTaskCreateOutput(
  content: unknown,
): TaskCreateOutput | undefined {
  const tryParse = (text: string): TaskCreateOutput | undefined => {
    try {
      const parsed = JSON.parse(text);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.task &&
        typeof parsed.task.id === "string"
      ) {
        return parsed as TaskCreateOutput;
      }
    } catch {
      // ignore
    }
    return undefined;
  };

  if (typeof content === "string") {
    return tryParse(content);
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text"
      ) {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string") {
          const parsed = tryParse(text);
          if (parsed) return parsed;
        }
      }
    }
  }
  return undefined;
}

export function applyTaskCreate(
  state: TaskState,
  input: TaskCreateInput | undefined,
  output: TaskCreateOutput | undefined,
): void {
  const taskId = output?.task?.id;
  if (!taskId || !input) return;
  state.set(taskId, {
    subject: input.subject,
    status: "pending",
    activeForm: input.activeForm,
    description: input.description,
  });
}

export function applyTaskUpdate(
  state: TaskState,
  input: TaskUpdateInput | undefined,
): void {
  if (!input?.taskId) return;
  if (input.status === "deleted") {
    state.delete(input.taskId);
    return;
  }
  const existing = state.get(input.taskId);
  const subject = input.subject ?? existing?.subject;
  if (!subject) return;
  state.set(input.taskId, {
    subject,
    status: input.status ?? existing?.status ?? "pending",
    activeForm: input.activeForm ?? existing?.activeForm,
    description: input.description ?? existing?.description,
  });
}

export function taskStateToPlanEntries(state: TaskState): PlanEntry[] {
  return Array.from(state.values()).map((task) => ({
    content: task.subject,
    status: task.status,
    priority: "medium",
  }));
}
