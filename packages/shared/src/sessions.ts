import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionConfigSelectOptions,
} from "@agentclientprotocol/sdk";
import type { SkillButtonId } from "./analytics-events";
import type { ExecutionMode } from "./exec-types";
import type { AcpMessage } from "./session-events";
import type { TaskRunStatus } from "./task";

export type Adapter = "claude" | "codex";

export type PermissionRequest = Omit<RequestPermissionRequest, "sessionId"> & {
  taskRunId: string;
  receivedAt: number;
};

export interface QueuedMessage {
  id: string;
  content: string;
  rawPrompt?: string | ContentBlock[];
  queuedAt: number;
}

export type OptimisticItem =
  | {
      type: "user_message";
      id: string;
      content: string;
      timestamp: number;
      pinToTop?: boolean;
    }
  | {
      type: "skill_button_action";
      id: string;
      buttonId: SkillButtonId;
    };

export type SessionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface AgentSession {
  taskRunId: string;
  taskId: string;
  taskTitle: string;
  channel: string;
  events: AcpMessage[];
  startedAt: number;
  status: SessionStatus;
  errorTitle?: string;
  errorMessage?: string;
  errorRetryable?: boolean;
  isPromptPending: boolean;
  isCompacting: boolean;
  promptStartedAt: number | null;
  currentPromptId?: number | null;
  logUrl?: string;
  processedLineCount?: number;
  framework?: "claude";
  adapter?: Adapter;
  configOptions?: SessionConfigOption[];
  pendingPermissions: Map<string, PermissionRequest>;
  pausedDurationMs: number;
  messageQueue: QueuedMessage[];
  isCloud?: boolean;
  cloudStatus?: TaskRunStatus;
  cloudStage?: string | null;
  cloudOutput?: Record<string, unknown> | null;
  cloudErrorMessage?: string | null;
  initialPrompt?: ContentBlock[];
  cloudBranch?: string | null;
  handoffInProgress?: boolean;
  skipPolledPromptCount?: number;
  optimisticItems: OptimisticItem[];
  contextUsed?: number;
  contextSize?: number;
  conversationSummary?: string;
  idleKilled?: boolean;
  agentVersion?: string;
  agentIdleForRunId?: string;
}

export function isSelectGroup(
  options: SessionConfigSelectOptions,
): options is SessionConfigSelectGroup[] {
  return (
    options.length > 0 &&
    typeof options[0] === "object" &&
    "options" in options[0]
  );
}

export function flattenSelectOptions(
  options: SessionConfigSelectOptions,
): SessionConfigSelectOption[] {
  if (!options.length) return [];
  if (isSelectGroup(options)) {
    return options.flatMap((group) => group.options);
  }
  return options as SessionConfigSelectOption[];
}

export function mergeConfigOptions(
  live: SessionConfigOption[],
  persisted: SessionConfigOption[],
): SessionConfigOption[] {
  const persistedMap = new Map(persisted.map((opt) => [opt.id, opt]));

  return live.map((liveOpt) => {
    const persistedOpt = persistedMap.get(liveOpt.id);
    if (persistedOpt) {
      return {
        ...liveOpt,
        currentValue: persistedOpt.currentValue,
      } as SessionConfigOption;
    }
    return liveOpt;
  });
}

export function getConfigOptionByCategory(
  configOptions: SessionConfigOption[] | undefined,
  category: string,
): SessionConfigOption | undefined {
  return configOptions?.find((opt) => opt.category === category);
}

export function cycleModeOption(
  modeOption: SessionConfigOption | undefined,
  options?: { allowBypassPermissions?: boolean },
): string | undefined {
  if (!modeOption || modeOption.type !== "select") return undefined;

  const allOptions = flattenSelectOptions(modeOption.options);
  const filtered = options?.allowBypassPermissions
    ? allOptions
    : allOptions.filter(
        (opt) =>
          opt.value !== "bypassPermissions" && opt.value !== "full-access",
      );
  if (filtered.length === 0) return undefined;

  const currentIndex = filtered.findIndex(
    (opt) => opt.value === modeOption.currentValue,
  );
  if (currentIndex === -1) return filtered[0]?.value;

  const nextIndex = (currentIndex + 1) % filtered.length;
  return filtered[nextIndex]?.value;
}

export function getCurrentModeFromConfigOptions(
  configOptions: SessionConfigOption[] | undefined,
): ExecutionMode | undefined {
  const modeOption = getConfigOptionByCategory(configOptions, "mode");
  return modeOption?.currentValue as ExecutionMode | undefined;
}
