import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { getReasoningEffortOptions } from "@posthog/agent/adapters/reasoning-effort";
import { flattenConfigValues } from "@posthog/core/task-detail/configOptions";
import {
  applyConfigChange,
  deriveInitialConfig,
} from "@posthog/core/task-detail/previewConfig";
import { useHostTRPCClient } from "@posthog/host-router/react";
import { getCloudUrlFromRegion } from "@posthog/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../../shell/logger";
import { useAuthStateValue } from "../../auth/store";
import { useSettingsStore } from "../../settings/settingsStore";

const log = logger.scope("preview-config");

interface PreviewConfigResult {
  configOptions: SessionConfigOption[];
  modeOption: SessionConfigOption | undefined;
  modelOption: SessionConfigOption | undefined;
  thoughtOption: SessionConfigOption | undefined;
  isLoading: boolean;
  setConfigOption: (configId: string, value: string) => void;
}

function getOptionByCategory(
  options: SessionConfigOption[],
  category: string,
): SessionConfigOption | undefined {
  return options.find(
    (opt) => opt.category === category || opt.id === category,
  );
}

/**
 * Fetches config options (models, modes, effort levels) for the task input
 * page via a lightweight tRPC query. No agent session is created.
 *
 * Returns config options as local state with a setter for local updates.
 */
export function usePreviewConfig(
  adapter: "claude" | "codex",
): PreviewConfigResult {
  const hostClient = useHostTRPCClient();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const apiHost = useMemo(
    () => (cloudRegion ? getCloudUrlFromRegion(cloudRegion) : null),
    [cloudRegion],
  );
  const [configOptions, setConfigOptions] = useState<SessionConfigOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const hasHydrated = useSettingsStore((state) => state._hasHydrated);

  useEffect(() => {
    if (!apiHost) return;

    // Wait for the settings store to finish its async hydration before
    // resolving the model. Otherwise lastUsedModel and lastUsedAdapter read as
    // their pre-hydration defaults, the restore below is skipped, and the
    // selector silently falls back to the server default (Opus for Claude).
    // isLoading initializes to true, so the picker stays loading until hydration
    // lands and the fetch below resolves.
    if (!hasHydrated) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsLoading(true);
    // Drop the previous adapter's options so a stale model id can never be sent
    // as the current selection while the new adapter's config is loading.
    setConfigOptions([]);

    hostClient.agent.getPreviewConfigOptions
      .query({ apiHost, adapter }, { signal: abort.signal })
      .then((options) => {
        if (abort.signal.aborted) return;

        const {
          defaultInitialTaskMode,
          lastUsedInitialTaskMode,
          defaultReasoningEffort,
          lastUsedReasoningEffort,
          lastUsedModel,
        } = useSettingsStore.getState();

        let initial = deriveInitialConfig(
          options,
          {
            defaultInitialTaskMode,
            lastUsedInitialTaskMode,
            defaultReasoningEffort,
            lastUsedReasoningEffort,
          },
          adapter,
        );

        // The server always returns its default model as the current value, so
        // without this the user's last pick (e.g. fable) is lost on every
        // refetch/remount. Restore it through applyConfigChange so the dependent
        // effort options are recomputed for the restored model.
        const modelOpt = getOptionByCategory(initial, "model");
        if (
          lastUsedModel &&
          modelOpt?.type === "select" &&
          modelOpt.currentValue !== lastUsedModel &&
          flattenConfigValues(modelOpt).includes(lastUsedModel)
        ) {
          initial = applyConfigChange(initial, {
            adapter,
            configId: modelOpt.id,
            value: lastUsedModel,
            effortOptions:
              getReasoningEffortOptions(adapter, lastUsedModel) ?? undefined,
            settings: {
              defaultInitialTaskMode: "",
              lastUsedInitialTaskMode: undefined,
              defaultReasoningEffort,
              lastUsedReasoningEffort,
            },
          });
        }

        setConfigOptions(initial);
        setIsLoading(false);
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        log.error("Failed to fetch preview config options", { error });
        setIsLoading(false);
      });

    return () => {
      abort.abort();
    };
  }, [adapter, apiHost, hostClient, hasHydrated]);

  const setConfigOption = useCallback(
    (configId: string, value: string) => {
      const effortOptions =
        configId === "model"
          ? (getReasoningEffortOptions(adapter, value) ?? undefined)
          : undefined;
      const { lastUsedReasoningEffort, defaultReasoningEffort } =
        useSettingsStore.getState();
      setConfigOptions((prev) =>
        applyConfigChange(prev, {
          adapter,
          configId,
          value,
          effortOptions,
          settings: {
            defaultInitialTaskMode: "",
            lastUsedInitialTaskMode: undefined,
            defaultReasoningEffort,
            lastUsedReasoningEffort,
          },
        }),
      );
    },
    [adapter],
  );

  const modeOption = getOptionByCategory(configOptions, "mode");
  const modelOption = getOptionByCategory(configOptions, "model");
  const thoughtOption = getOptionByCategory(configOptions, "thought_level");

  return {
    configOptions,
    modeOption,
    modelOption,
    thoughtOption,
    isLoading,
    setConfigOption,
  };
}
