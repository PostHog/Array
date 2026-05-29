import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Adapter, StoredLogEntry } from "@posthog/shared";
import { getAvailableCodexModes, getAvailableModes } from "./executionModes";

/**
 * Pure derivations of cloud session config options. No store or host access —
 * just shaping the config-option list the mode switcher renders.
 */

/**
 * Pull the most recent `config_option_update` payload out of a run's stored log
 * entries, so a reconnecting cloud session restores its last known options.
 */
export function extractLatestConfigOptionsFromEntries(
  entries: StoredLogEntry[],
): SessionConfigOption[] | undefined {
  let latest: SessionConfigOption[] | undefined;
  for (const entry of entries) {
    if (
      entry.type !== "notification" ||
      entry.notification?.method !== "session/update"
    ) {
      continue;
    }
    const params = entry.notification.params as
      | {
          update?: {
            sessionUpdate?: string;
            configOptions?: SessionConfigOption[];
          };
        }
      | undefined;
    if (
      params?.update?.sessionUpdate === "config_option_update" &&
      params.update.configOptions
    ) {
      latest = params.update.configOptions;
    }
  }
  return latest;
}

/**
 * Build default configOptions for cloud sessions so the mode switcher is
 * available in the UI even without a local agent connection.
 *
 * The `extra` options (model, thought_level) come from the preview-config trpc
 * query, which is async. Callers populate them after the session exists.
 */
export function buildCloudDefaultConfigOptions(
  initialMode: string | undefined,
  adapter: Adapter = "claude",
  extra: SessionConfigOption[] = [],
): SessionConfigOption[] {
  const modes =
    adapter === "codex" ? getAvailableCodexModes() : getAvailableModes();
  const currentMode =
    typeof initialMode === "string"
      ? initialMode
      : adapter === "codex"
        ? "auto"
        : "plan";
  return [
    {
      id: "mode",
      name: "Approval Preset",
      type: "select",
      currentValue: currentMode,
      options: modes.map((mode) => ({
        value: mode.id,
        name: mode.name,
      })),
      category: "mode" as SessionConfigOption["category"],
      description: "Choose an approval and sandboxing preset for your session",
    },
    ...extra,
  ];
}
