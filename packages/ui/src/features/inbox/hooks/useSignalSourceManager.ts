import type {
  Evaluation,
  SignalSourceConfig,
} from "@posthog/api-client/posthog-client";
import { SIGNAL_SOURCE_SERVICE } from "@posthog/core/inbox/identifiers";
import {
  computeSourceValues,
  deriveSourceStates,
  type SignalSourceService,
  type SignalSourceValues,
} from "@posthog/core/inbox/signalSourceService";
import { useService } from "@posthog/di/react";
import { getCloudUrlFromRegion } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type {
  SignalTeamConfig,
  SignalUserAutonomyConfig,
} from "@posthog/shared/domain-types";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { track } from "@posthog/ui/shell/analytics";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useEvaluations } from "./useEvaluations";
import { useExternalDataSources } from "./useExternalDataSources";
import { useSignalSourceConfigs } from "./useSignalSourceConfigs";
import { useSignalTeamConfig } from "./useSignalTeamConfig";
import { useSignalUserAutonomyConfig } from "./useSignalUserAutonomyConfig";

type WarehouseSource = "github" | "linear" | "zendesk" | "pganalyze";

function isWarehouseSource(
  source: keyof SignalSourceValues,
): source is WarehouseSource {
  return (
    source === "github" ||
    source === "linear" ||
    source === "zendesk" ||
    source === "pganalyze"
  );
}

export function useSignalSourceManager() {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const service = useService<SignalSourceService>(SIGNAL_SOURCE_SERVICE);
  const { data: configs, isLoading: configsLoading } = useSignalSourceConfigs();
  const { data: externalSources, isLoading: sourcesLoading } =
    useExternalDataSources();
  const { data: evaluations } = useEvaluations();
  const { data: teamConfig, isLoading: teamConfigLoading } =
    useSignalTeamConfig();
  const { data: userAutonomyConfig, isLoading: userAutonomyConfigLoading } =
    useSignalUserAutonomyConfig();

  const [optimistic, setOptimistic] = useState<
    Partial<Record<keyof SignalSourceValues, boolean>>
  >({});
  const [setupSource, setSetupSource] = useState<WarehouseSource | null>(null);
  const [loadingSources, setLoadingSources] = useState<
    Partial<Record<keyof SignalSourceValues, boolean>>
  >({});

  const isLoading = configsLoading || sourcesLoading;

  const serverValues = useMemo(() => computeSourceValues(configs), [configs]);

  const displayValues = useMemo<SignalSourceValues>(() => {
    if (Object.keys(optimistic).length === 0) return serverValues;
    return { ...serverValues, ...optimistic };
  }, [serverValues, optimistic]);

  const sourceStates = useMemo(() => {
    const derived = deriveSourceStates(configs, externalSources);
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
    for (const product of Object.keys(
      derived,
    ) as (keyof SignalSourceValues)[]) {
      const state = derived[product];
      if (state) {
        states[product] = {
          requiresSetup: state.requiresSetup,
          loading: !!loadingSources[product],
          syncStatus: state.syncStatus,
        };
      }
    }
    return states;
  }, [configs, externalSources, loadingSources]);

  const evaluationsUrl = useMemo(() => {
    if (!cloudRegion) return "";
    return `${getCloudUrlFromRegion(cloudRegion)}/llm-analytics/evaluations`;
  }, [cloudRegion]);

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
        await service.toggleEvaluation(
          client,
          projectId,
          evaluationId,
          enabled,
        );
        await queryClient.invalidateQueries({ queryKey: ["evaluations"] });
      } catch (error: unknown) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to toggle evaluation",
        );
      } finally {
        setOptimisticEvals((prev) => {
          const next = { ...prev };
          delete next[evaluationId];
          return next;
        });
      }
    },
    [client, projectId, queryClient, service],
  );

  const invalidateAfterToggle = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["signals", "source-configs"],
      }),
      queryClient.invalidateQueries({ queryKey: ["inbox", "signal-reports"] }),
    ]);
  }, [queryClient]);

  const handleToggle = useCallback(
    async (product: keyof SignalSourceValues, enabled: boolean) => {
      if (!client || !projectId) return;

      const willSetup =
        enabled &&
        isWarehouseSource(product) &&
        service.requiresSetup(product, externalSources);
      if (willSetup) {
        setSetupSource(product as WarehouseSource);
        return;
      }

      const isSyncing = enabled && isWarehouseSource(product);
      if (isSyncing) {
        setLoadingSources((prev) => ({ ...prev, [product]: true }));
      }
      setOptimistic((prev) => ({ ...prev, [product]: enabled }));

      try {
        const result = await service.toggleSource(
          client,
          projectId,
          product,
          enabled,
          configs,
          externalSources,
        );
        if (enabled) {
          track(ANALYTICS_EVENTS.SIGNAL_SOURCE_CONNECTED, {
            source_product: product,
            is_first_connection: result.isFirstConnection,
            via_setup_wizard: false,
          });
        }
        await invalidateAfterToggle();
      } catch (error: unknown) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Failed to toggle ${product}`,
        );
      } finally {
        if (isSyncing) {
          setLoadingSources((prev) => ({ ...prev, [product]: false }));
        }
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
      externalSources,
      invalidateAfterToggle,
      service,
    ],
  );

  const handleSetup = useCallback((source: keyof SignalSourceValues) => {
    if (isWarehouseSource(source)) {
      setSetupSource(source);
    }
  }, []);

  const handleSetupComplete = useCallback(async () => {
    const completedSource = setupSource;
    setSetupSource(null);

    if (completedSource && client && projectId) {
      try {
        const result = await service.completeSetup(
          client,
          projectId,
          completedSource,
          configs,
        );
        track(ANALYTICS_EVENTS.SIGNAL_SOURCE_CONNECTED, {
          source_product: completedSource,
          is_first_connection: result.isFirstConnection,
          via_setup_wizard: true,
        });
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
      queryClient.invalidateQueries({ queryKey: ["inbox", "signal-reports"] }),
    ]);
  }, [queryClient, setupSource, configs, client, projectId, service]);

  const handleSetupCancel = useCallback(() => {
    setSetupSource(null);
  }, []);

  const handleUpdateAutostartPriority = useCallback(
    async (priority: string) => {
      if (!client) return;
      try {
        await service.updateAutostartPriority(client, priority);
        await queryClient.invalidateQueries({
          queryKey: ["signals", "team-config"],
        });
      } catch (error: unknown) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update autostart priority",
        );
      }
    },
    [client, queryClient, service],
  );

  const handleUpdateTeamSlackChannel = useCallback(
    async (channel: string | null) => {
      if (!client) return;
      try {
        await client.updateSignalTeamConfig({
          default_slack_notification_channel: channel,
        });
        await queryClient.invalidateQueries({
          queryKey: ["signals", "team-config"],
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update default notification channel";
        toast.error(message);
      }
    },
    [client, queryClient],
  );

  const handleUpdateUserAutonomyPriority = useCallback(
    async (priority: string | null) => {
      if (!client) return;
      try {
        await service.updateUserAutonomyPriority(client, priority);
        await queryClient.invalidateQueries({
          queryKey: ["signals", "user-autonomy-config"],
        });
      } catch (error: unknown) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update autonomy setting",
        );
      }
    },
    [client, queryClient, service],
  );

  const handleUpdateAutostartBaseBranches = useCallback(
    async (branches: Record<string, string>) => {
      if (!client) return;

      const queryKey = ["signals", "team-config"];
      const previous = queryClient.getQueryData<SignalTeamConfig | null>(
        queryKey,
      );

      if (previous) {
        queryClient.setQueryData<SignalTeamConfig | null>(queryKey, {
          ...previous,
          autostart_base_branches: branches,
        });
      }

      try {
        const fresh = await client.updateSignalTeamConfig({
          autostart_base_branches: branches,
        });
        queryClient.setQueryData<SignalTeamConfig | null>(queryKey, fresh);
      } catch (error: unknown) {
        queryClient.setQueryData<SignalTeamConfig | null>(
          queryKey,
          previous ?? null,
        );
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update base branch setting";
        toast.error(message);
      }
    },
    [client, queryClient],
  );

  const handleUpdateSlackNotifications = useCallback(
    async (updates: {
      integrationId?: number | null;
      channel?: string | null;
      minPriority?: string | null;
    }) => {
      if (!client) return;

      const queryKey = ["signals", "user-autonomy-config"];
      const previous =
        queryClient.getQueryData<SignalUserAutonomyConfig | null>(queryKey);

      const optimisticNext: SignalUserAutonomyConfig = {
        ...(previous ??
          ({ autostart_priority: null } as SignalUserAutonomyConfig)),
        ...("integrationId" in updates
          ? { slack_notification_integration_id: updates.integrationId ?? null }
          : {}),
        ...("channel" in updates
          ? { slack_notification_channel: updates.channel ?? null }
          : {}),
        ...("minPriority" in updates
          ? {
              slack_notification_min_priority:
                (updates.minPriority as
                  | SignalUserAutonomyConfig["slack_notification_min_priority"]
                  | null
                  | undefined) ?? null,
            }
          : {}),
      };
      queryClient.setQueryData<SignalUserAutonomyConfig | null>(
        queryKey,
        optimisticNext,
      );

      try {
        const fresh = await service.updateSlackNotifications(client, updates);
        queryClient.setQueryData<SignalUserAutonomyConfig | null>(
          queryKey,
          fresh,
        );
      } catch (error: unknown) {
        queryClient.setQueryData<SignalUserAutonomyConfig | null>(
          queryKey,
          previous ?? null,
        );
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update Slack notification setting",
        );
      }
    },
    [client, queryClient, service],
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
    teamConfigLoading,
    handleUpdateAutostartPriority,
    handleUpdateTeamSlackChannel,
    userAutonomyConfig,
    userAutonomyConfigLoading,
    handleUpdateUserAutonomyPriority,
    handleUpdateAutostartBaseBranches,
    handleUpdateSlackNotifications,
  };
}
