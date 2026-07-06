import { useHostTRPC } from "@posthog/host-router/react";
import { flattenSelectOptions, getCloudUrlFromRegion } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface ModelOption {
  value: string;
  name: string;
}

export function useAvailableModelOptions(
  adapter: "claude" | "codex",
): ModelOption[] {
  const hostTRPC = useHostTRPC();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const apiHost = useMemo(
    () => (cloudRegion ? getCloudUrlFromRegion(cloudRegion) : null),
    [cloudRegion],
  );

  const { data: configOptions } = useQuery({
    ...hostTRPC.agent.getPreviewConfigOptions.queryOptions({
      apiHost: apiHost ?? "",
      adapter,
    }),
    enabled: !!apiHost,
  });

  return useMemo(() => {
    const modelOpt = configOptions?.find(
      (o) => o.category === "model" || o.id === "model",
    );
    if (!modelOpt || modelOpt.type !== "select") return [];
    return flattenSelectOptions(modelOpt.options);
  }, [configOptions]);
}
