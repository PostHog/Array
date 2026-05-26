import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { getReasoningEffortOptions } from "@posthog/agent/adapters/reasoning-effort";
import { trpcClient } from "@renderer/trpc/client";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flattenConfigValues } from "../utils/configOptions";

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

const EFFORT_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
};

/**
 * Clamp a desired effort to the nearest level the current model supports.
 * Falls back to the highest supported level when the desired level has no
 * known rank (e.g. unrecognized value from older settings).
 */
function clampEffortToAvailable(
  desired: string,
  available: string[],
): string | null {
  if (available.length === 0) return null;
  if (available.includes(desired)) return desired;

  const desiredRank = EFFORT_RANK[desired];
  if (desiredRank === undefined) {
    return available[available.length - 1];
  }

  const ranked = available
    .map((value) => ({ value, rank: EFFORT_RANK[value] }))
    .filter((entry): entry is { value: string; rank: number } =>
      Number.isFinite(entry.rank),
    );
  if (ranked.length === 0) return available[0];

  return ranked.reduce((closest, entry) =>
    Math.abs(entry.rank - desiredRank) < Math.abs(closest.rank - desiredRank)
      ? entry
      : closest,
  ).value;
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
          defaultReasoningEffort,
          lastUsedReasoningEffort,
        } = useSettingsStore.getState();

        // Use the mode option's existing currentValue (set by the server
        // based on the adapter) when the user hasn't chosen a preference,
        // or when their last-used mode doesn't match the current adapter's
        // available modes.
        const modeOpt = options.find((o) => o.id === "mode");
        const serverDefault = modeOpt?.currentValue;
        const availableValues: string[] = modeOpt
          ? flattenConfigValues(modeOpt)
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
          const validValues = flattenConfigValues(opt);
          if (defaultReasoningEffort === "last_used") {
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
          }
          const clamped = clampEffortToAvailable(
            defaultReasoningEffort,
            validValues,
          );
          if (clamped) {
            return {
              ...opt,
              currentValue: clamped,
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

          const { lastUsedReasoningEffort, defaultReasoningEffort } =
            useSettingsStore.getState();
          const isValidEffort = (effort: unknown): effort is string =>
            typeof effort === "string" &&
            !!effortOpts?.some((e) => e.value === effort);
          const resolveEffortFallback = (): string => {
            if (
              defaultReasoningEffort !== "last_used" &&
              isValidEffort(defaultReasoningEffort)
            ) {
              return defaultReasoningEffort;
            }
            return isValidEffort(lastUsedReasoningEffort)
              ? lastUsedReasoningEffort
              : "high";
          };
          if (effortOpts && existingIdx >= 0) {
            const currentEffort = updated[existingIdx].currentValue;
            const nextEffort = isValidEffort(currentEffort)
              ? currentEffort
              : resolveEffortFallback();
            updated[existingIdx] = {
              ...updated[existingIdx],
              currentValue: nextEffort,
              options: effortOpts,
            } as SessionConfigOption;
          } else if (effortOpts && existingIdx === -1) {
            const nextEffort = resolveEffortFallback();
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
