export interface CodexModePreset {
  id: "plan" | "read-only" | "auto" | "full-access";
  name: string;
  description: string;
}

/**
 * The codex mode presets every picker shows (task creation and live session).
 * One copy so the pickers (agent execution-mode.ts, core executionModes.ts)
 * and the adapter's behavioral map (codex-app-server session-config.ts) cannot
 * drift; each consumer owns only its own gating and policy mapping.
 */
export const CODEX_MODE_PRESETS: readonly CodexModePreset[] = [
  {
    id: "plan",
    name: "Plan",
    description: "Plan first — inspect and propose; makes no changes",
  },
  {
    id: "read-only",
    name: "Read only",
    description: "Read-only — can inspect but not modify files",
  },
  {
    id: "auto",
    name: "Auto",
    description: "Edits the workspace; asks before risky operations",
  },
  {
    id: "full-access",
    name: "Full access",
    description: "Auto-approves all operations",
  },
];
