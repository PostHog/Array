import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { getReasoningEffortOptions } from "@posthog/agent/adapters/reasoning-effort";
import { trpcClient } from "@renderer/trpc/client";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function flattenValues(
  options: Array<{ value?: string; options?: Array<{ value: string }> }>,
): string[] {
  return options.flatMap((o) =>
    o.options ? o.options.map((go) => go.value) : o.value ? [o.value] : [],
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

    trpcClient.agent.getPreviewConfigOptions
      .query({ apiHost, adapter })
      .then((options) => {
        if (abort.signal.aborted) return;

        const {
          defaultInitialTaskMode,
          lastUsedInitialTaskMode,
          lastUsedReasoningEffort,
        } = useSettingsStore.getState();

        // Use the mode option's existing currentValue (set by the server
        // based on the adapter) when the user hasn't chosen a preference,
        // or when their last-used mode doesn't match the current adapter's
        // available modes.
        const modeOpt = options.find((o) => o.id === "mode");
        const serverDefault = modeOpt?.currentValue;
        const availableValues: string[] =
          modeOpt?.type === "select"
            ? flattenValues(
                modeOpt.options as Array<{
                  value?: string;
                  options?: Array<{ value: string }>;
                }>,
              )
            : [];

        let initialMode: string;
        if (
          defaultInitialTaskMode === "last_used" &&
          lastUsedInitialTaskMode &&
          availableValues.includes(lastUsedInitialTaskMode)
        ) {
          initialMode = lastUsedInitialTaskMode;
        } else {
          const fallbackDefault = adapter === "codex" ? "auto" : "plan";
          initialMode =
            typeof serverDefault === "string" &&
            availableValues.includes(serverDefault)
              ? serverDefault
              : fallbackDefault;
        }

        const withMode = options.map((opt) =>
          opt.id === "mode"
            ? ({ ...opt, currentValue: initialMode } as SessionConfigOption)
            : opt,
        );

        const withEffort = withMode.map((opt) => {
          if (opt.category !== "thought_level" || opt.type !== "select") {
            return opt;
          }
          const validValues = flattenValues(
            opt.options as Array<{
              value?: string;
              options?: Array<{ value: string }>;
            }>,
          );
          if (
            lastUsedReasoningEffort &&
            validValues.includes(lastUsedReasoningEffort)
          ) {
            return {
              ...opt,
              currentValue: lastUsedReasoningEffort,
            } as SessionConfigOption;
          }
          return opt;
        });

        setConfigOptions(withEffort);
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
  }, [adapter, apiHost]);

  const setConfigOption = useCallback(
    (configId: string, value: string) => {
      setConfigOptions((prev) => {
        let updated = prev.map((opt) =>
          opt.id === configId
            ? ({ ...opt, currentValue: value } as SessionConfigOption)
            : opt,
        );

        if (configId === "model") {
          const effortOpts = getReasoningEffortOptions(adapter, value);
          const existingIdx = updated.findIndex(
            (o) => o.category === "thought_level",
          );
          const effortOptionId =
            existingIdx >= 0
              ? updated[existingIdx].id
              : adapter === "codex"
                ? "reasoning_effort"
                : "effort";

          const { lastUsedReasoningEffort } = useSettingsStore.getState();
          const isValidEffort = (effort: unknown): effort is string =>
            typeof effort === "string" &&
            !!effortOpts?.some((e) => e.value === effort);
          if (effortOpts && existingIdx >= 0) {
            const currentEffort = updated[existingIdx].currentValue;
            const nextEffort = isValidEffort(currentEffort)
              ? currentEffort
              : isValidEffort(lastUsedReasoningEffort)
                ? lastUsedReasoningEffort
                : "high";
            updated[existingIdx] = {
              ...updated[existingIdx],
              currentValue: nextEffort,
              options: effortOpts,
            } as SessionConfigOption;
          } else if (effortOpts && existingIdx === -1) {
            const nextEffort = isValidEffort(lastUsedReasoningEffort)
              ? lastUsedReasoningEffort
              : "high";
            updated = [
              ...updated,
              {
                id: effortOptionId,
                name: adapter === "codex" ? "Reasoning Level" : "Effort",
                type: "select",
                currentValue: nextEffort,
                options: effortOpts,
                category: "thought_level",
                description:
                  adapter === "codex"
                    ? "Controls how much reasoning effort the model uses"
                    : "Controls how much effort Claude puts into its response",
              } as SessionConfigOption,
            ];
          } else if (!effortOpts && existingIdx >= 0) {
            updated = updated.filter((o) => o.category !== "thought_level");
          }
        }

        return updated;
      });
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
