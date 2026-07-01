import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { type GatewayModel, isOpenAIModel } from "../../gateway-models";
import { getReasoningEffortOptions } from "../codex/models";

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
 * Per-turn sandbox the mode maps to (a subset of codex's SandboxPolicy). This is
 * what makes read-only/plan actually BLOCK edits — `approvalPolicy` alone is
 * neutralized because the process spawns under `workspace-write`/`danger-full-access`.
 * (Plan ALSO sets codex's `collaborationMode` on turn/start — a separate axis,
 * see codex-app-server-agent.ts — which unlocks plan proposals + request_user_input.)
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
  /**
   * codex's native collaboration mode, sent per-turn on `turn/start`. "plan"
   * makes codex propose a plan and unlocks `request_user_input` (AskUserQuestion);
   * everything else runs in "default". This is what makes Plan a real mode rather
   * than a relabeled read-only sandbox.
   */
  collaborationMode?: "plan" | "default";
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
    collaborationMode: "plan",
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
 * codex collaboration mode for a preset — "plan" only for the Plan preset, else
 * "default". Switching away from Plan must reset to "default", so this never
 * returns undefined.
 */
export function collaborationModeFor(modeId: string | undefined): "plan" | "default" {
  return CODEX_MODES.find((m) => m.id === modeId)?.collaborationMode ?? "default";
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

/** The current selector values `buildConfigOptions` projects into ACP options. */
export interface ConfigSelectors {
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
  s: ConfigSelectors,
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

/** A model entry from the app-server's `model/list` (loosely typed). */
interface RawModel {
  id?: string;
  model?: string;
  displayName?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string } | string>;
}

/**
 * Stateful holder for a codex session's model / reasoning-effort / mode
 * selectors and the ACP `configOptions` derived from them.
 *
 * The native app-server has no `configOptions` or `mode` concept — it's
 * configured by `model` + per-turn `approvalPolicy`/`sandbox`/`collaborationMode`
 * — so this synthesizes the Claude-style picker the host renders, and rebuilds
 * the options on every change. The agent owns the transport; this owns the state
 * and its projection through the pure builders above.
 */
export class SessionConfigState {
  private _model: string;
  private _effort?: string;
  private _mode = DEFAULT_MODE;
  private models: Array<{ id: string; name: string }> = [];
  private efforts: string[] = [];
  private _options: SessionConfigOption[] = [];

  constructor(model: string, effort?: string) {
    this._model = model;
    this._effort = effort;
    this.rebuild();
  }

  get model(): string {
    return this._model;
  }
  get effort(): string | undefined {
    return this._effort;
  }
  get mode(): string {
    return this._mode;
  }
  get options(): SessionConfigOption[] {
    return this._options;
  }

  /** Apply the host's initial approval mode (from `_meta.permissionMode`). */
  setInitialMode(permissionMode: string | undefined): void {
    this._mode = resolveInitialMode(permissionMode);
    this.rebuild();
  }

  /**
   * Apply a `setSessionConfigOption` change. Returns whether the mode changed,
   * so the caller can emit `current_mode_update`.
   */
  setOption(
    configId: string | undefined,
    value: unknown,
  ): { modeChanged: boolean } {
    let modeChanged = false;
    if (typeof value === "string") {
      if (configId === "model") this._model = value;
      else if (configId === "effort") this._effort = value;
      else if (configId === "mode") {
        this._mode = value;
        modeChanged = true;
      }
    }
    this.rebuild();
    return { modeChanged };
  }

  /**
   * Populate the model + reasoning-effort selectors from a `model/list` `data`
   * array. model/list comes through the PostHog gateway, which also serves
   * Claude models, so drop non-OpenAI ones. The gateway doesn't populate
   * reasoning efforts, so fall back to the shared codex model→effort map (which
   * surfaces "xhigh" for the gpt-5.5 family); if the gateway starts reporting
   * efforts they win.
   */
  loadModels(rawModels: RawModel[]): void {
    this.models = rawModels
      .filter((m) => !m?.hidden)
      .filter((m) => isOpenAIModel(m as unknown as GatewayModel))
      .map((m) => ({
        id: (m.id ?? m.model) as string,
        name: (m.displayName ?? m.id ?? m.model) as string,
      }));
    const current = rawModels.find(
      (m) => m.id === this._model || m.model === this._model,
    );
    const liveEfforts = (current?.supportedReasoningEfforts ?? [])
      .map((e) => (typeof e === "string" ? e : e?.reasoningEffort))
      .filter((e): e is string => typeof e === "string");
    this.efforts = liveEfforts.length
      ? liveEfforts
      : getReasoningEffortOptions(this._model).map((o) => o.value);
    this.rebuild();
  }

  /** Reset the model/effort lists (model/list failed); keeps the current model. */
  clearModels(): void {
    this.models = [];
    this.efforts = [];
    this.rebuild();
  }

  /**
   * codex's per-turn `collaborationMode` field: `{ mode, settings: { model } }`.
   * `plan` unlocks plan proposals + request_user_input; `default` reverts. The
   * model must be a string (not the null in collaborationMode/list output).
   */
  collaborationModeForTurn(): unknown {
    return {
      mode: collaborationModeFor(this._mode),
      settings: { model: this._model },
    };
  }

  /** The AskForApproval policy for the current mode (turn/start `approvalPolicy`). */
  approvalPolicy(): string | undefined {
    return modeApprovalPolicy(this._mode);
  }

  /** The per-turn sandbox override for the current mode, if any. */
  sandboxPolicy(): CodexSandboxPolicy | undefined {
    return sandboxPolicyFor(this._mode);
  }

  private rebuild(): void {
    this._options = buildConfigOptions({
      mode: this._mode,
      model: this._model,
      effort: this._effort,
      models: this.models,
      efforts: this.efforts,
    });
  }
}
