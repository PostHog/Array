import {
  type Adapter,
  buildCloudTaskConfigOptions,
  type CloudTaskConfigOption,
  GLM_MODEL_FLAG,
  isGlmModelId,
} from "@posthog/shared";
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlag } from "posthog-react-native";
import { useAuthStore } from "@/features/auth";
import { getPostHogApiClient } from "@/lib/posthogApiClient";

export const cloudTaskConfigOptionKeys = {
  all: ["cloud-task-config-options"] as const,
  adapter: (adapter: Adapter) =>
    [...cloudTaskConfigOptionKeys.all, adapter] as const,
};

const fallbackOptionsByAdapter: Record<Adapter, CloudTaskConfigOption[]> = {
  claude: buildCloudTaskConfigOptions([], "claude"),
  codex: buildCloudTaskConfigOptions([], "codex"),
};

export function useCloudTaskConfigOptions(adapter: Adapter = "claude") {
  const oauthAccessToken = useAuthStore((state) => state.oauthAccessToken);
  const glmEnabled = useFeatureFlag(GLM_MODEL_FLAG);
  const query = useQuery({
    queryKey: cloudTaskConfigOptionKeys.adapter(adapter),
    queryFn: () => getPostHogApiClient().getCloudTaskConfigOptions(adapter),
    enabled: !!oauthAccessToken,
    staleTime: 5 * 60 * 1000,
  });
  const configOptions = query.data ?? fallbackOptionsByAdapter[adapter];
  const visibleConfigOptions = glmEnabled
    ? configOptions
    : configOptions.map((option) =>
        option.category === "model"
          ? {
              ...option,
              options: option.options.filter(
                (model) => !isGlmModelId(model.value),
              ),
            }
          : option,
      );

  return {
    ...query,
    configOptions: visibleConfigOptions,
    hasLiveConfig: query.data !== undefined,
  };
}
