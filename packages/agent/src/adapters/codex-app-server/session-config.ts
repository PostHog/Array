import type { SessionConfigOption } from "@agentclientprotocol/sdk";

/**
 * Session config + mode synthesis for the codex app-server adapter.
 *
 * PostHog Code expects ACP `configOptions` (model + reasoning-effort selectors)
 * and a `mode` switcher. The native app-server has no "mode" RPC — a thread is
 * configured by `approvalPolicy` + `sandbox` — so the modes are synthesized here
 * and applied per-turn. We mirror the codex-acp adapter, which surfaces only
 * `model` + `thought_level` configOptions (mode is driven via
 * `setSessionConfigOption`, not listed as a configOption).
 */

/**
 * Per-turn sandbox the mode maps to (a subset of codex's SandboxPolicy). The
 * picker's restriction lives here, NOT in `collaborationMode` — that field is
 * silently dropped by the app-server (it only exists in server→client
 * ThreadSettings), and `approvalPolicy` alone is neutralized because the process
 * spawns under `danger-full-access`. `readOnly` is the only honored way to make
 * plan/read-only actually block edits.
 */
export type CodexSandboxPolicy =
  | { type: "readOnly"; networkAccess: boolean }
  | { type: "dangerFullAccess" };

export interface CodexMode {
  id: string;
  name: string;
  description: string;
  /** codex AskForApproval the mode maps to, applied per-turn on turn/start. */
  approvalPolicy: string;
  /**
   * Per-turn sandbox override (turn/start `sandboxPolicy`). Undefined means keep
   * the spawned `danger-full-access` (can edit). Applied only off the cloud
   * sandbox, where a non-danger policy would re-engage the unavailable
   * linux-sandbox and panic — see codex-app-server-agent.ts.
   */
  sandboxPolicy?: CodexSandboxPolicy;
}

// Flattened Claude-style presets. Restriction is driven by approvalPolicy +
// sandboxPolicy (the only honored levers); plan/read-only block edits via a
// read-only sandbox, auto/full-access keep the spawned full-access sandbox.
export const CODEX_MODES: CodexMode[] = [
  {
    id: "plan",
    name: "Plan",
    description: "Plan first — inspect and propose; makes no changes",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
  },
  {
    id: "read-only",
    name: "Read only",
    description: "Read-only — can inspect but not modify files",
    approvalPolicy: "untrusted",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
  },
  {
    id: "auto",
    name: "Auto",
    description: "Edits the workspace; asks before risky operations",
    approvalPolicy: "on-request",
  },
  {
    id: "full-access",
    name: "Full access",
    description: "Auto-approves all operations",
    approvalPolicy: "never",
  },
];

export const DEFAULT_MODE = "auto";

export function modeApprovalPolicy(
  modeId: string | undefined,
): string | undefined {
  return CODEX_MODES.find((m) => m.id === modeId)?.approvalPolicy;
}

/** Per-turn sandbox for a mode id (undefined keeps the spawned full-access). */
export function sandboxPolicyFor(
  modeId: string | undefined,
): CodexSandboxPolicy | undefined {
  return CODEX_MODES.find((m) => m.id === modeId)?.sandboxPolicy;
}

/**
 * Resolve the host's initial `_meta.permissionMode` to a codex mode — mirroring
 * codex-acp's toCodexPermissionMode. A recognized codex mode is honored; any
 * other value (e.g. a Claude-style "bypassPermissions") falls back to the
 * default so the session starts in a sane approval policy.
 */
export function resolveInitialMode(permissionMode: string | undefined): string {
  return permissionMode && CODEX_MODES.some((m) => m.id === permissionMode)
    ? permissionMode
    : DEFAULT_MODE;
}

/** Codex's standard reasoning efforts; used when model/list doesn't expose them. */
export const DEFAULT_EFFORTS = ["low", "medium", "high"];

// Display labels for reasoning efforts. Mirrors codex/models.ts and
// claude/session/models.ts so the live selector matches the preview path
// (the host renders `name` verbatim — raw "low" would show lowercase).
const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

function humanizeEffort(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

export interface SessionConfigState {
  /** Current permission/collaboration preset id (one of CODEX_MODES). */
  mode: string;
  model: string;
  effort?: string;
  /** From model/list; falls back to the single current model when empty. */
  models: Array<{ id: string; name: string }>;
  /** Reasoning efforts supported by the current model. */
  efforts: string[];
}

/** Builds the ACP configOptions (mode + model + thought_level) the host renders. */
export function buildConfigOptions(
  s: SessionConfigState,
): SessionConfigOption[] {
  const baseModels = s.models.length
    ? s.models
    : [{ id: s.model, name: s.model }];
  // Ensure the active model/effort is always a selectable option, even if
  // model/list omitted it or a mid-session switch moved off the listed set —
  // otherwise the selector's currentValue points at nothing.
  const models = baseModels.some((m) => m.id === s.model)
    ? baseModels
    : [...baseModels, { id: s.model, name: s.model }];
  const baseEfforts = s.efforts.length ? s.efforts : DEFAULT_EFFORTS;
  const currentEffort = s.effort ?? baseEfforts[0];
  const efforts = baseEfforts.includes(currentEffort)
    ? baseEfforts
    : [...baseEfforts, currentEffort];
  return [
    {
      type: "select",
      id: "mode",
      name: "Mode",
      category: "mode",
      currentValue: s.mode,
      options: CODEX_MODES.map((m) => ({
        name: m.name,
        value: m.id,
        description: m.description,
      })),
    } as unknown as SessionConfigOption,
    {
      type: "select",
      id: "model",
      name: "Model",
      category: "model",
      currentValue: s.model,
      options: models.map((m) => ({ name: m.name, value: m.id })),
    } as unknown as SessionConfigOption,
    {
      type: "select",
      id: "effort",
      name: "Reasoning effort",
      category: "thought_level",
      currentValue: currentEffort,
      options: efforts.map((e) => ({ name: humanizeEffort(e), value: e })),
    } as unknown as SessionConfigOption,
  ];
}
