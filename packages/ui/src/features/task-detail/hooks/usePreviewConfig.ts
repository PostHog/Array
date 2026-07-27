import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  getContextWindowOptions,
  getFastModeOptions,
  getReasoningEffortOptions,
} from "@posthog/agent/adapters/reasoning-effort";
import { flattenConfigValues } from "@posthog/core/task-detail/configOptions";
import {
  applyConfigChange,
  deriveInitialConfig,
} from "@posthog/core/task-detail/previewConfig";
import { useHostTRPCClient } from "@posthog/host-router/react";
import {
  type Adapter,
  FAST_MODE_FLAG,
  GLM_MODEL_FLAG,
  getCloudUrlFromRegion,
  KIMI_MODEL_FLAG,
} from "@posthog/shared";
import {
  stripGlmModelOption,
  stripKimiModelOption,
} from "@posthog/ui/features/sessions/modelOptionFilters";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../../shell/logger";
import { useAuthStateValue } from "../../auth/store";
import { useFeatureFlag } from "../../feature-flags/useFeatureFlag";
import { useSettingsStore } from "../../settings/settingsStore";

const log = logger.scope("preview-config");

interface PreviewConfigResult {
  configOptions: SessionConfigOption[];
  modeOption: SessionConfigOption | undefined;
  modelOption: SessionConfigOption | undefined;
  thoughtOption: SessionConfigOption | undefined;
  contextWindowOption: SessionConfigOption | undefined;
  fastModeOption: SessionConfigOption | undefined;
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
export function usePreviewConfig(adapter: Adapter): PreviewConfigResult {
  const hostClient = useHostTRPCClient();
  const glmEnabled = useFeatureFlag(GLM_MODEL_FLAG);
  const kimiEnabled = useFeatureFlag(KIMI_MODEL_FLAG);
  const fastModeFlagEnabled = useFeatureFlag(FAST_MODE_FLAG, true);
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
      .then((serverOptions) => {
        if (abort.signal.aborted) return;

        const options = serverOptions
          .map((option) => {
            const withoutGlm = glmEnabled
              ? option
              : stripGlmModelOption(option);
            return kimiEnabled ? withoutGlm : stripKimiModelOption(withoutGlm);
          })
          .filter((option) => fastModeFlagEnabled || option.id !== "fast");

        const {
          defaultInitialTaskMode,
          lastUsedInitialTaskMode,
          defaultReasoningEffort,
          lastUsedReasoningEffort,
          lastUsedContextWindow,
          lastUsedFastMode,
          lastUsedModel,
        } = useSettingsStore.getState();

        let initial = deriveInitialConfig(
          options,
          {
            defaultInitialTaskMode,
            lastUsedInitialTaskMode,
            defaultReasoningEffort,
            lastUsedReasoningEffort,
            lastUsedContextWindow,
            lastUsedFastMode,
          },
          adapter,
        );

        // The server always returns its default model as the current value, so
        // without this the user's last (default-eligible) pick is lost on every
        // refetch/remount. Restore it through applyConfigChange so the
        // dependent effort options are recomputed for the restored model.
        const modelOpt = getOptionByCategory(initial, "model");
        // The user's explicit last pick always restores, premium families
        // included — a fresh launch must not silently downgrade the model.
        const restorableModel = lastUsedModel ?? undefined;
        if (
          restorableModel &&
          modelOpt?.type === "select" &&
          modelOpt.currentValue !== restorableModel &&
          flattenConfigValues(modelOpt).includes(restorableModel)
        ) {
          initial = applyConfigChange(initial, {
            adapter,
            configId: modelOpt.id,
            value: restorableModel,
            effortOptions:
              getReasoningEffortOptions(adapter, restorableModel) ?? undefined,
            contextWindowOptions:
              getContextWindowOptions(adapter, restorableModel) ?? undefined,
            fastModeOptions: fastModeFlagEnabled
              ? (getFastModeOptions(adapter, restorableModel) ?? undefined)
              : undefined,
            settings: {
              defaultInitialTaskMode: "",
              lastUsedInitialTaskMode: undefined,
              defaultReasoningEffort,
              lastUsedReasoningEffort,
              lastUsedContextWindow,
              lastUsedFastMode,
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
  }, [
    adapter,
    apiHost,
    hostClient,
    hasHydrated,
    glmEnabled,
    kimiEnabled,
    fastModeFlagEnabled,
  ]);

  const setConfigOption = useCallback(
    (configId: string, value: string) => {
      const isModelChange = configId === "model";
      const effortOptions = isModelChange
        ? (getReasoningEffortOptions(adapter, value) ?? undefined)
        : undefined;
      const contextWindowOptions = isModelChange
        ? (getContextWindowOptions(adapter, value) ?? undefined)
        : undefined;
      const fastModeOptions =
        isModelChange && fastModeFlagEnabled
          ? (getFastModeOptions(adapter, value) ?? undefined)
          : undefined;
      const settingsStore = useSettingsStore.getState();
      if (
        configId === "context_window" &&
        (value === "200k" || value === "1m")
      ) {
        settingsStore.setLastUsedContextWindow(value);
      } else if (configId === "fast") {
        settingsStore.setLastUsedFastMode(value === "on");
      }
      setConfigOptions((prev) =>
        applyConfigChange(prev, {
          adapter,
          configId,
          value,
          effortOptions,
          contextWindowOptions,
          fastModeOptions,
          settings: {
            defaultInitialTaskMode: "",
            lastUsedInitialTaskMode: undefined,
            defaultReasoningEffort: settingsStore.defaultReasoningEffort,
            lastUsedReasoningEffort: settingsStore.lastUsedReasoningEffort,
            lastUsedContextWindow: settingsStore.lastUsedContextWindow,
            lastUsedFastMode: settingsStore.lastUsedFastMode,
          },
        }),
      );
    },
    [adapter, fastModeFlagEnabled],
  );

  const modeOption = getOptionByCategory(configOptions, "mode");
  const modelOption = getOptionByCategory(configOptions, "model");
  const thoughtOption = getOptionByCategory(configOptions, "thought_level");
  const contextWindowOption = getOptionByCategory(
    configOptions,
    "_context_window",
  );
  const fastModeOption = getOptionByCategory(configOptions, "_fast_mode");

  return {
    configOptions,
    modeOption,
    modelOption,
    thoughtOption,
    contextWindowOption,
    fastModeOption,
    isLoading,
    setConfigOption,
  };
}
