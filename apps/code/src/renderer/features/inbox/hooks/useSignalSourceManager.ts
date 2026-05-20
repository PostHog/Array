import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import type { SignalSourceValues } from "@features/inbox/components/SignalSourceToggles";
import type {
  Evaluation,
  SignalSourceConfig,
} from "@renderer/api/posthogClient";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useEvaluations } from "./useEvaluations";
import { useExternalDataSources } from "./useExternalDataSources";
import { useSignalSourceConfigs } from "./useSignalSourceConfigs";
import { useSignalTeamConfig } from "./useSignalTeamConfig";
import { useSignalUserAutonomyConfig } from "./useSignalUserAutonomyConfig";

type SourceProduct = SignalSourceConfig["source_product"];
type SourceType = SignalSourceConfig["source_type"];

const SOURCE_TYPE_MAP: Record<
  Exclude<SourceProduct, "error_tracking" | "llm_analytics">,
  SourceType
> = {
  session_replay: "session_analysis_cluster",
  github: "issue",
  linear: "issue",
  zendesk: "ticket",
  conversations: "ticket",
  pganalyze: "issue",
};

const ERROR_TRACKING_SOURCE_TYPES: SourceType[] = [
  "issue_created",
  "issue_reopened",
  "issue_spiking",
];

const SOURCE_LABELS: Record<keyof SignalSourceValues, string> = {
  session_replay: "Session replay",
  error_tracking: "Error tracking",
  github: "GitHub Issues",
  linear: "Linear Issues",
  zendesk: "Zendesk Tickets",
  conversations: "PostHog Support",
  pganalyze: "pganalyze",
};

const DATA_WAREHOUSE_SOURCES: Record<
  string,
  { dwSourceType: string; requiredTable: string }
> = {
  github: { dwSourceType: "Github", requiredTable: "issues" },
  linear: { dwSourceType: "Linear", requiredTable: "issues" },
  zendesk: { dwSourceType: "Zendesk", requiredTable: "tickets" },
  pganalyze: { dwSourceType: "PgAnalyze", requiredTable: "issues" },
};

const ALL_SOURCE_PRODUCTS: (keyof SignalSourceValues)[] = [
  "session_replay",
  "error_tracking",
  "github",
  "linear",
  "zendesk",
  "conversations",
  "pganalyze",
];

function computeValues(
  configs: SignalSourceConfig[] | undefined,
): SignalSourceValues {
  const result: SignalSourceValues = {
    session_replay: false,
    error_tracking: false,
    github: false,
    linear: false,
    zendesk: false,
    conversations: false,
    pganalyze: false,
  };
  if (!configs?.length) return result;
  for (const product of ALL_SOURCE_PRODUCTS) {
    if (product === "error_tracking") {
      result.error_tracking = ERROR_TRACKING_SOURCE_TYPES.every((st) =>
        configs.some(
          (c) =>
            c.source_product === "error_tracking" &&
            c.source_type === st &&
            c.enabled,
        ),
      );
    } else {
      result[product] = configs.some(
        (c) => c.source_product === product && c.enabled,
      );
    }
  }
  return result;
}

export function useSignalSourceManager() {
  const projectId = useAuthStateValue((state) => state.projectId);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const { data: configs, isLoading: configsLoading } = useSignalSourceConfigs();
  const { data: externalSources, isLoading: sourcesLoading } =
    useExternalDataSources();
  const { data: evaluations } = useEvaluations();
  const { data: teamConfig } = useSignalTeamConfig();
  const { data: userAutonomyConfig } = useSignalUserAutonomyConfig();

  // Optimistic overrides keyed by source product — only sources actively being
  // toggled get an entry, so unrelated sources never see a prop change.
  const [optimistic, setOptimistic] = useState<
    Partial<Record<keyof SignalSourceValues, boolean>>
  >({});
  const pendingRef = useRef(new Set<keyof SignalSourceValues>());

  const [setupSource, setSetupSource] = useState<
    "github" | "linear" | "zendesk" | "pganalyze" | null
  >(null);
  const [loadingSources, setLoadingSources] = useState<
    Partial<Record<keyof SignalSourceValues, boolean>>
  >({});

  const isLoading = configsLoading || sourcesLoading;

  const findExternalSource = useCallback(
    (product: string) => {
      const dwConfig = DATA_WAREHOUSE_SOURCES[product];
      if (!dwConfig || !externalSources) return null;
      return externalSources.find(
        (s) =>
          s.source_type.toLowerCase() === dwConfig.dwSourceType.toLowerCase(),
      );
    },
    [externalSources],
  );

  const serverValues = useMemo<SignalSourceValues>(
    () => computeValues(configs),
    [configs],
  );

  // Merge: optimistic overrides take precedence over server values.
  const displayValues = useMemo<SignalSourceValues>(() => {
    if (Object.keys(optimistic).length === 0) return serverValues;
    return { ...serverValues, ...optimistic };
  }, [serverValues, optimistic]);

  const sourceStates = useMemo(() => {
    const states: Partial<
      Record<
        keyof SignalSourceValues,
        {
          requiresSetup: boolean;
          loading: boolean;
          syncStatus?: SignalSourceConfig["status"];
        }
      >
    > = {};
    for (const product of ALL_SOURCE_PRODUCTS) {
      if (
        product === "github" ||
        product === "linear" ||
        product === "zendesk" ||
        product === "pganalyze"
      ) {
        const hasExternalSource = !!findExternalSource(product);
        const isEnabled = serverValues[product];
        const config = configs?.find((c) => c.source_product === product);
        states[product] = {
          requiresSetup: !hasExternalSource && !isEnabled,
          loading: !!loadingSources[product],
          syncStatus: config?.status ?? null,
        };
      } else {
        const config = configs?.find((c) => c.source_product === product);
        states[product] = {
          requiresSetup: false,
          loading: false,
          syncStatus: config?.status ?? null,
        };
      }
    }
    return states;
  }, [findExternalSource, serverValues, loadingSources, configs]);

  const evaluationsUrl = useMemo(() => {
    if (!cloudRegion) return "";
    return `${getCloudUrlFromRegion(cloudRegion)}/llm-analytics/evaluations`;
  }, [cloudRegion]);

  // Optimistic evaluation state: map of evaluation ID to overridden enabled value
  const [optimisticEvals, setOptimisticEvals] = useState<
    Record<string, boolean>
  >({});

  const displayEvaluations = useMemo<Evaluation[]>(() => {
    if (!evaluations) return [];
    if (Object.keys(optimisticEvals).length === 0) return evaluations;
    return evaluations.map((e) =>
      e.id in optimisticEvals ? { ...e, enabled: optimisticEvals[e.id] } : e,
    );
  }, [evaluations, optimisticEvals]);

  const handleToggleEvaluation = useCallback(
    async (evaluationId: string, enabled: boolean) => {
      if (!client || !projectId) return;

      setOptimisticEvals((prev) => ({ ...prev, [evaluationId]: enabled }));

      try {
        await client.updateEvaluation(projectId, evaluationId, { enabled });
        await queryClient.invalidateQueries({ queryKey: ["evaluations"] });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to toggle evaluation";
        toast.error(message);
      } finally {
        setOptimisticEvals((prev) => {
          const next = { ...prev };
          delete next[evaluationId];
          return next;
        });
      }
    },
    [client, projectId, queryClient],
  );

  const ensureRequiredTableSyncing = useCallback(
    async (product: string) => {
      if (!projectId || !client) return;
      const dwConfig = DATA_WAREHOUSE_SOURCES[product];
      if (!dwConfig) return;

      const source = findExternalSource(product);
      if (!source?.schemas || !Array.isArray(source.schemas)) return;

      const requiredSchema = source.schemas.find(
        (s) => s.name.toLowerCase() === dwConfig.requiredTable,
      );
      if (!requiredSchema) return;

      const issuesFullReplication =
        (product === "github" || product === "linear") &&
        dwConfig.requiredTable === "issues";

      if (issuesFullReplication) {
        const syncType = requiredSchema.sync_type;
        const needsUpdate =
          !requiredSchema.should_sync || syncType !== "full_refresh";

        if (needsUpdate) {
          await client.updateExternalDataSchema(projectId, requiredSchema.id, {
            should_sync: true,
            sync_type: "full_refresh",
          });
        }
        return;
      }

      if (!requiredSchema.should_sync) {
        await client.updateExternalDataSchema(projectId, requiredSchema.id, {
          should_sync: true,
        });
      }
    },
    [projectId, client, findExternalSource],
  );

  const handleSetup = useCallback((source: keyof SignalSourceValues) => {
    if (
      source === "github" ||
      source === "linear" ||
      source === "zendesk" ||
      source === "pganalyze"
    ) {
      setSetupSource(source);
    }
  }, []);

  const invalidateAfterToggle = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["signals", "source-configs"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["inbox", "signal-reports"],
      }),
    ]);
  }, [queryClient]);

  // Toggle a single source product. Calls the API directly (no react-query
  // mutation tracking) so intermediate loading/success states don't cause
  // cascading re-renders.
  const handleToggle = useCallback(
    async (product: keyof SignalSourceValues, enabled: boolean) => {
      if (!client || !projectId) return;
      if (pendingRef.current.has(product)) return;

      // Warehouse sources without a connected external data source need setup first
      if (enabled && product in DATA_WAREHOUSE_SOURCES) {
        const hasExternalSource = !!findExternalSource(product);
        if (!hasExternalSource) {
          setSetupSource(
            product as "github" | "linear" | "zendesk" | "pganalyze",
          );
          return;
        }

        setLoadingSources((prev) => ({ ...prev, [product]: true }));
        try {
          await ensureRequiredTableSyncing(product);
        } finally {
          setLoadingSources((prev) => ({ ...prev, [product]: false }));
        }
      }

      // Optimistic update — only touches this one key
      pendingRef.current.add(product);
      setOptimistic((prev) => ({ ...prev, [product]: enabled }));

      const label = SOURCE_LABELS[product];

      try {
        if (product === "error_tracking") {
          for (const sourceType of ERROR_TRACKING_SOURCE_TYPES) {
            const existing = configs?.find(
              (c) =>
                c.source_product === "error_tracking" &&
                c.source_type === sourceType,
            );
            if (existing) {
              await client.updateSignalSourceConfig(projectId, existing.id, {
                enabled,
              });
            } else if (enabled) {
              await client.createSignalSourceConfig(projectId, {
                source_product: "error_tracking",
                source_type: sourceType,
                enabled: true,
              });
            }
          }
        } else {
          const existing = configs?.find((c) => c.source_product === product);
          if (existing) {
            await client.updateSignalSourceConfig(projectId, existing.id, {
              enabled,
            });
          } else if (enabled) {
            await client.createSignalSourceConfig(projectId, {
              source_product: product,
              source_type:
                SOURCE_TYPE_MAP[
                  product as Exclude<
                    SourceProduct,
                    "error_tracking" | "llm_analytics"
                  >
                ],
              enabled: true,
            });
          }
        }

        await invalidateAfterToggle();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : `Failed to toggle ${label}`;
        toast.error(message);
      } finally {
        pendingRef.current.delete(product);
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[product];
          return next;
        });
      }
    },
    [
      client,
      projectId,
      configs,
      findExternalSource,
      ensureRequiredTableSyncing,
      invalidateAfterToggle,
    ],
  );

  const handleSetupComplete = useCallback(async () => {
    const completedSource = setupSource;
    setSetupSource(null);

    if (completedSource && client && projectId) {
      const existing = configs?.find(
        (c) => c.source_product === completedSource,
      );
      try {
        if (!existing) {
          await client.createSignalSourceConfig(projectId, {
            source_product: completedSource,
            source_type: SOURCE_TYPE_MAP[completedSource],
            enabled: true,
          });
        } else if (!existing.enabled) {
          await client.updateSignalSourceConfig(projectId, existing.id, {
            enabled: true,
          });
        }
      } catch {
        toast.error(
          "Data source connected, but failed to enable signal source. Try toggling it on.",
        );
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["external-data-sources"] }),
      queryClient.invalidateQueries({
        queryKey: ["signals", "source-configs"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["inbox", "signal-reports"],
      }),
    ]);
  }, [queryClient, setupSource, configs, client, projectId]);

  const handleSetupCancel = useCallback(() => {
    setSetupSource(null);
  }, []);

  const handleUpdateAutostartPriority = useCallback(
    async (priority: string) => {
      if (!client) return;
      try {
        await client.updateSignalTeamConfig({
          default_autostart_priority: priority,
        });
        await queryClient.invalidateQueries({
          queryKey: ["signals", "team-config"],
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update autostart priority";
        toast.error(message);
      }
    },
    [client, queryClient],
  );

  const handleUpdateUserAutonomyPriority = useCallback(
    async (priority: string | null) => {
      if (!client) return;
      try {
        if (priority === null) {
          await client.deleteSignalUserAutonomyConfig();
        } else {
          await client.updateSignalUserAutonomyConfig({
            autostart_priority: priority,
          });
        }
        await queryClient.invalidateQueries({
          queryKey: ["signals", "user-autonomy-config"],
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update autonomy setting";
        toast.error(message);
      }
    },
    [client, queryClient],
  );

  return {
    displayValues,
    sourceStates,

    setupSource,
    isLoading,
    handleToggle,
    handleSetup,
    handleSetupComplete,
    handleSetupCancel,
    evaluations: displayEvaluations,
    evaluationsUrl,
    handleToggleEvaluation,
    teamConfig,
    handleUpdateAutostartPriority,
    userAutonomyConfig,
    handleUpdateUserAutonomyPriority,
  };
}
