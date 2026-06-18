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
