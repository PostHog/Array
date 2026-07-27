import type {
  PiCommand,
  PiNativeModelInfo,
  PiSessionStatus,
  PiThinkingLevel,
} from "@posthog/agent/pi/types";
import type {
  AgentConversationEvent,
  SessionStatus,
  TaskRunStatus,
} from "@posthog/shared";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface PiControllerSessionState {
  connectionState: SessionStatus;
  events: AgentConversationEvent[];
  models: PiNativeModelInfo[];
  modelsLoaded: boolean;
  thinkingLevels: PiThinkingLevel[];
  thinkingLevelsLoaded: boolean;
  commands: PiCommand[];
  status?: PiSessionStatus;
  cloudStatus?: TaskRunStatus;
  errorTitle?: string;
  errorMessage?: string;
  errorRetryable?: boolean;
  isBashRunning: boolean;
}

export interface PiSessionState {
  sessions: Record<string, PiControllerSessionState>;
}

export type PiSessionStore = StoreApi<PiSessionState>;

export function createPiSessionStore(): PiSessionStore {
  return createStore<PiSessionState>(() => ({ sessions: {} }));
}

export function createEmptyPiControllerSession(): PiControllerSessionState {
  return {
    connectionState: "connecting",
    events: [],
    models: [],
    modelsLoaded: false,
    thinkingLevels: [],
    thinkingLevelsLoaded: false,
    commands: [],
    isBashRunning: false,
  };
}
