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
  {
    id: "bypassPermissions",
    name: "Bypass Permissions",
    description: "Auto-accept all permission requests",
  },
  {
    id: "auto",
    name: "Auto Mode",
    description: "Use a model classifier to approve/deny permission prompts",
  },
];

// Mirrors the codex app-server adapter's CODEX_MODES so the picker offers the
// same presets as a live session. "plan" is a CodeExecutionMode codex-acp maps
// to read-only and the app-server gives a read-only sandbox — safe on both.
const codexModes: ModeInfo[] = [
  {
    id: "plan",
    name: "Plan",
    description: "Plan first — inspect and propose; makes no changes",
  },
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
  {
    id: "full-access",
    name: "Full Access",
    description: "Auto-accept all permission requests",
  },
];

export function getAvailableModes(): ModeInfo[] {
  return availableModes;
}

export function getAvailableCodexModes(): ModeInfo[] {
  return codexModes;
}
