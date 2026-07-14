import type { Adapter } from "@posthog/shared";
import type { AgentMode } from "../types";
import type { RtkSavingsSummary } from "./rtk-savings";
import type { RemoteMcpServer } from "./schemas";

export interface ClaudeCodeConfig {
  systemPrompt?:
    | string
    | { type: "preset"; preset: "claude_code"; append?: string };
  plugins?: { type: "local"; path: string }[];
}

export interface AgentServerConfig {
  port: number;
  agentStateDir?: string;
  repositoryPath?: string;
  repoReadyFile?: string;
  apiUrl: string;
  apiKey: string;
  projectId: number;
  jwtPublicKey: string; // RS256 public key for JWT verification
  eventIngestToken?: string;
  // Base URL for the event-ingest POST only; falls back to apiUrl when unset.
  eventIngestBaseUrl?: string;
  eventIngestStreamWindowMs?: number;
  eventIngestKeepStreamOpen?: boolean;
  mode: AgentMode;
  taskId: string;
  runId: string;
  createPr?: boolean;
  // User-opted auto-publish: push and open a draft PR on completion even for
  // manual (non-automated-origin) cloud runs. createPr=false still wins.
  autoPublish?: boolean;
  version?: string;
  mcpServers?: RemoteMcpServer[];
  baseBranch?: string;
  claudeCode?: ClaudeCodeConfig;
  allowedDomains?: string[];
  runtimeAdapter?: Adapter;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  resolveRtkSavings?: () => Promise<RtkSavingsSummary | null>;
}
