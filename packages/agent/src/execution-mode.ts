import { type Adapter, CODEX_MODE_PRESETS } from "@posthog/shared";
import { ALLOW_BYPASS } from "./utils/common";

export interface ModeInfo {
  id: string;
  name: string;
  description: string;
}

const availableModes: ModeInfo[] = [
  {
    id: "default",
    name: "Default",
    description: "Standard behavior, prompts for dangerous operations",
  },
  {
    id: "acceptEdits",
    name: "Accept Edits",
    description: "Auto-accept file edit operations",
  },
  {
    id: "plan",
    name: "Plan Mode",
    description: "Planning mode, no actual tool execution",
  },
];

if (ALLOW_BYPASS) {
  availableModes.push(
    {
      id: "bypassPermissions",
      name: "Bypass Permissions",
      description: "Auto-accept all permission requests",
    },
    {
      id: "auto",
      name: "Auto Mode",
      description: "Auto-approve file edits and shell commands",
    },
  );
}

// Expose execution mode IDs in type-safe order for type checks
export const CODE_EXECUTION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
] as const;

export type CodeExecutionMode = (typeof CODE_EXECUTION_MODES)[number];

export function isCodeExecutionMode(mode: string): mode is CodeExecutionMode {
  return (CODE_EXECUTION_MODES as readonly string[]).includes(mode);
}

export function getAvailableModes(): ModeInfo[] {
  return ALLOW_BYPASS
    ? availableModes
    : availableModes.filter((m) => m.id !== "bypassPermissions");
}

// --- Codex-native modes ---

export const CODEX_NATIVE_MODES = ["auto", "read-only", "full-access"] as const;

export type CodexNativeMode = (typeof CODEX_NATIVE_MODES)[number];

/** Union of all permission mode IDs across adapters */
export type PermissionMode = CodeExecutionMode | CodexNativeMode;

export function isCodexNativeMode(mode: string): mode is CodexNativeMode {
  return (CODEX_NATIVE_MODES as readonly string[]).includes(mode);
}

// The preset literals live in @posthog/shared (one copy for every picker and
// the app-server adapter's CODEX_MODES); this module only owns the gating.
export function getAvailableCodexModes(): ModeInfo[] {
  return ALLOW_BYPASS
    ? [...CODEX_MODE_PRESETS]
    : CODEX_MODE_PRESETS.filter((m) => m.id !== "full-access");
}

// The cloud task-run API validates initial_permission_mode against a per-adapter
// enum that is narrower than the local pickers: codex accepts only its native
// modes (notably not "plan", which the local app-server adapter synthesizes).
// Degrade to the nearest mode with the same permission ceiling.
const CODEX_CLOUD_MODE_FALLBACKS: Record<
  Exclude<CodeExecutionMode, "auto">,
  CodexNativeMode
> = {
  default: "auto",
  acceptEdits: "auto",
  plan: "read-only",
  bypassPermissions: "full-access",
};

const CLAUDE_CLOUD_MODE_FALLBACKS: Record<
  Exclude<CodexNativeMode, "auto">,
  CodeExecutionMode
> = {
  "read-only": "plan",
  "full-access": "bypassPermissions",
};

export function resolveCloudInitialPermissionMode(
  adapter: Adapter | undefined,
  mode: PermissionMode,
): PermissionMode {
  if (adapter === "codex") {
    return isCodexNativeMode(mode) ? mode : CODEX_CLOUD_MODE_FALLBACKS[mode];
  }
  if (adapter === "claude") {
    return isCodeExecutionMode(mode) ? mode : CLAUDE_CLOUD_MODE_FALLBACKS[mode];
  }
  return mode;
}
