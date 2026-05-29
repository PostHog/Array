import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { getReasoningEffortOptions } from "@posthog/agent/adapters/reasoning-effort";
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

  useEffect(() => {
    if (!apiHost) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsLoading(true);

    hostClient.agent.getPreviewConfigOptions
      .query({ apiHost, adapter }, { signal: abort.signal })
      .then((options) => {
        if (abort.signal.aborted) return;

        const {
          defaultInitialTaskMode,
          lastUsedInitialTaskMode,
          defaultReasoningEffort,
          lastUsedReasoningEffort,
        } = useSettingsStore.getState();

        setConfigOptions(
          deriveInitialConfig(
            options,
            {
              defaultInitialTaskMode,
              lastUsedInitialTaskMode,
              defaultReasoningEffort,
              lastUsedReasoningEffort,
            },
            adapter,
          ),
        );
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
  }, [adapter, apiHost, hostClient]);

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
