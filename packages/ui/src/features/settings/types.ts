export type SettingsCategory =
  | "general"
  | "plan-usage"
  | "workspaces"
  | "worktrees"
  | "environments"
  | "cloud-environments"
  | "personalization"
  | "terminal"
  | "claude-code"
  | "shortcuts"
  | "github"
  | "slack"
  | "signals"
  | "updates"
  | "advanced"
  | "discord";

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  "general",
  "plan-usage",
  "workspaces",
  "worktrees",
  "environments",
  "cloud-environments",
  "personalization",
  "terminal",
  "claude-code",
  "shortcuts",
  "github",
  "slack",
  "signals",
  "updates",
  "advanced",
  "discord",
];

export function isSettingsCategory(value: string): value is SettingsCategory {
  return (SETTINGS_CATEGORIES as readonly string[]).includes(value);
}
