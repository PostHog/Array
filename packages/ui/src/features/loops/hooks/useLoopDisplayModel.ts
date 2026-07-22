import type { LoopSchemas } from "@posthog/api-client/loops";
import {
  REPORT_MODEL_RESOLVER,
  type ReportModelResolver,
} from "@posthog/core/inbox/identifiers";
import { useService } from "@posthog/di/react";
import { getCloudUrlFromRegion } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useQuery } from "@tanstack/react-query";

export function useLoopDisplayModel(
  adapter: LoopSchemas.LoopRuntimeAdapterEnum,
  configuredModel: string,
): string {
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const modelResolver = useService<ReportModelResolver>(REPORT_MODEL_RESOLVER);
  const { data } = useQuery({
    queryKey: ["loops", "default-model", cloudRegion, adapter],
    queryFn: () => {
      if (!cloudRegion) return undefined;
      return modelResolver.resolveDefaultModel(
        getCloudUrlFromRegion(cloudRegion),
        adapter,
      );
    },
    enabled: !configuredModel && !!cloudRegion,
    staleTime: 5 * 60_000,
  });

  return configuredModel || data || "Default model";
}
