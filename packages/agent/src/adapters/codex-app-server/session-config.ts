import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { CODEX_MODE_PRESETS, type CodexModePreset } from "@posthog/shared";
import { type GatewayModel, isOpenAIModel } from "../../gateway-models";
import { getReasoningEffortOptions } from "./models";

/**
 * Session config + mode synthesis for the codex app-server adapter. The native
 * app-server has no "mode" RPC (a thread is configured by `approvalPolicy` +
 * `sandbox`), so modes are synthesized here and applied per-turn.
 */

/**
 * Per-turn sandbox the mode maps to (subset of codex's SandboxPolicy). This is
 * what makes read-only/plan actually block edits — `approvalPolicy` alone is
 * neutralized because the process spawns editable.
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
   * Per-turn sandbox override; undefined keeps the spawned editable sandbox.
   * Only applied off the cloud sandbox, where a non-danger policy would re-engage
   * the unavailable linux-sandbox and panic.
   */
  sandboxPolicy?: CodexSandboxPolicy;
  /**
   * codex's native collaboration mode (per-turn on `turn/start`). "plan" unlocks
   * plan proposals + `request_user_input`; everything else runs "default".
   */
  collaborationMode?: "plan" | "default";
  /**
   * codex's named permission profile (per-turn `activePermissionProfile.extends`).
   * codex 0.140.0 enforces the sandbox through these built-in profiles; the raw
   * `sandboxPolicy` is no longer honored alone. Undefined keeps the spawned default.
   */
  permissionProfile?: string;
}

// Flattened Claude-style presets: the `{id, name, description}` literals live
// in @posthog/shared (one copy for every picker); this map owns the behavior.
// Restriction is driven by approvalPolicy + the named permissionProfile (codex
// 0.140.0's enforced sandbox lever); plan/read-only block edits,
// auto/full-access keep the spawned editable sandbox.
const CODEX_MODE_POLICIES: Record<
  CodexModePreset["id"],
  Pick<
    CodexMode,
    | "approvalPolicy"
    | "sandboxPolicy"
    | "permissionProfile"
    | "collaborationMode"
  >
> = {
  plan: {
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
    permissionProfile: ":read-only",
    collaborationMode: "plan",
  },
  "read-only": {
    approvalPolicy: "untrusted",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
    permissionProfile: ":read-only",
  },
  auto: {
    approvalPolicy: "on-request",
  },
  "full-access": {
    approvalPolicy: "never",
  },
};

export const CODEX_MODES: CodexMode[] = CODEX_MODE_PRESETS.map((preset) => ({
  ...preset,
  ...CODEX_MODE_POLICIES[preset.id],
}));

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

/** Named permission profile for a mode (undefined keeps the spawned default). */
export function permissionProfileFor(
  modeId: string | undefined,
): string | undefined {
  return CODEX_MODES.find((m) => m.id === modeId)?.permissionProfile;
}

/** codex collaboration mode for a preset — "plan" only for Plan, else "default". */
export function collaborationModeFor(
  modeId: string | undefined,
): "plan" | "default" {
  return (
    CODEX_MODES.find((m) => m.id === modeId)?.collaborationMode ?? "default"
  );
}

/**
 * Resolve the host's initial `_meta.permissionMode` to a codex mode. A recognized
 * mode is honored; anything else (e.g. "bypassPermissions") falls back to default.
 */
export function resolveInitialMode(permissionMode: string | undefined): string {
  return permissionMode && CODEX_MODES.some((m) => m.id === permissionMode)
    ? permissionMode
    : DEFAULT_MODE;
}

/** Codex's standard reasoning efforts; used when model/list doesn't expose them. */
export const DEFAULT_EFFORTS = ["low", "medium", "high"];

// Display labels for reasoning efforts; the host renders `name` verbatim.
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
  efforts: string[];
}

/** Builds the ACP configOptions (mode + model + thought_level) the host renders. */
export function buildConfigOptions(s: ConfigSelectors): SessionConfigOption[] {
  const baseModels = s.models.length
    ? s.models
    : [{ id: s.model, name: s.model }];
  // Ensure the active model stays selectable, else currentValue points at nothing.
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
 * Stateful holder for a codex session's model / effort / mode selectors and the
 * ACP `configOptions` derived from them — synthesizing the Claude-style picker
 * the app-server has no native concept of, rebuilt on every change.
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

  /** Apply a `setSessionConfigOption` change; returns whether the mode changed. */
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
   * Populate the model + effort selectors from a `model/list` `data` array. The
   * gateway also serves Claude models, so drop non-OpenAI ones; it doesn't
   * populate efforts, so fall back to the shared codex model→effort map.
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
   * codex's per-turn `collaborationMode`: `{ mode, settings: { model } }`. The
   * model must be a string (not the null in collaborationMode/list output).
   */
  collaborationModeForTurn(): unknown {
    return {
      mode: collaborationModeFor(this._mode),
      settings: { model: this._model },
    };
  }

  approvalPolicy(): string | undefined {
    return modeApprovalPolicy(this._mode);
  }

  sandboxPolicy(): CodexSandboxPolicy | undefined {
    return sandboxPolicyFor(this._mode);
  }

  /** Per-turn `activePermissionProfile` (codex 0.140.0's enforced sandbox), or undefined. */
  permissionProfile(): { extends: string } | undefined {
    const profile = permissionProfileFor(this._mode);
    return profile ? { extends: profile } : undefined;
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
