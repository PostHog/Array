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

const codexModes: ModeInfo[] = [
  {
    id: "read-only",
    name: "Read Only",
    description: "Read-only access, no file modifications",
  },
  {
    id: "auto",
    name: "Auto",
    description: "Standard behavior, prompts for dangerous operations",
  },
];

if (ALLOW_BYPASS) {
  codexModes.push({
    id: "full-access",
    name: "Full Access",
    description: "Auto-accept all permission requests",
  });
}

export function getAvailableCodexModes(): ModeInfo[] {
  return ALLOW_BYPASS
    ? codexModes
    : codexModes.filter((m) => m.id !== "full-access");
}
