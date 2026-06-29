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

export interface CodexMode {
  id: string;
  name: string;
  description: string;
  /** codex AskForApproval the mode maps to, applied per-turn on turn/start. */
  approvalPolicy: string;
}

export const CODEX_MODES: CodexMode[] = [
  {
    id: "read-only",
    name: "Read only",
    description: "Asks before any change",
    approvalPolicy: "untrusted",
  },
  {
    id: "auto",
    name: "Auto",
    description: "Asks before risky operations",
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

export interface SessionConfigState {
  model: string;
  effort?: string;
  /** From model/list; falls back to the single current model when empty. */
  models: Array<{ id: string; name: string }>;
  /** Reasoning efforts supported by the current model. */
  efforts: string[];
}

/** Builds the ACP configOptions (model + thought_level) the host renders. */
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
      options: efforts.map((e) => ({ name: e, value: e })),
    } as unknown as SessionConfigOption,
  ];
}
