import { SandboxCustomImagesDisabledError } from "@posthog/api-client/posthog-client";
import {
  isImageBuildInProgress,
  type SandboxCustomImage,
} from "@posthog/shared/domain-types";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthenticatedMutation } from "../../../../hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "../../../../hooks/useAuthenticatedQuery";
import { toast } from "../../../../primitives/toast";
import { watchImageBuild } from "./imageBuildWatcher";
import { sandboxEnvKeys } from "./useSandboxEnvironments";

const sandboxCustomImageKeys = {
  list: ["sandbox-custom-images", "list"] as const,
  detail: (id: string) => ["sandbox-custom-images", "detail", id] as const,
};

export function useSandboxCustomImageDetail(imageId: string) {
  return useAuthenticatedQuery(
    sandboxCustomImageKeys.detail(imageId),
    (client) => client.getSandboxCustomImage(imageId),
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status && isImageBuildInProgress(status) ? 2500 : false;
      },
    },
  );
}

export function useSandboxCustomImages() {
  const queryClient = useQueryClient();

  const {
    data: images,
    isLoading,
    error,
  } = useAuthenticatedQuery(
    sandboxCustomImageKeys.list,
    (client) => client.listSandboxCustomImages(),
    {
      retry: (failureCount, error) =>
        !(error instanceof SandboxCustomImagesDisabledError) &&
        failureCount < 3,
      refetchInterval: (query) => {
        if (query.state.error instanceof SandboxCustomImagesDisabledError) {
          return false;
        }
        return query.state.data?.some((image) =>
          isImageBuildInProgress(image.status),
        )
          ? 5000
          : false;
      },
      refetchIntervalInBackground: true,
    },
  );

  const customImagesEnabled = images !== undefined;
  const customImagesDisabled =
    error instanceof SandboxCustomImagesDisabledError;

  const onImageMutated = (image: SandboxCustomImage): void => {
    queryClient.setQueryData(sandboxCustomImageKeys.detail(image.id), image);
    queryClient.invalidateQueries({ queryKey: sandboxCustomImageKeys.list });
  };

  const createMutation = useAuthenticatedMutation(
    (
      client,
      input: {
        name: string;
        description?: string;
        repository?: string | null;
        private?: boolean;
      },
    ) => client.createSandboxCustomImage(input),
    {
      onSuccess: (image) => {
        toast.success("Custom image created");
        onImageMutated(image);
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to create custom image");
      },
    },
  );

  const buildMutation = useAuthenticatedMutation(
    (client, { id, specYaml }: { id: string; specYaml?: string | null }) =>
      client.buildSandboxCustomImage(id, specYaml).then((image) => {
        watchImageBuild(client, image.id, () => {
          queryClient.invalidateQueries({
            queryKey: sandboxCustomImageKeys.list,
          });
        });
        return image;
      }),
    {
      onSuccess: (image) => {
        toast.success("Build started");
        onImageMutated(image);
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to build custom image");
      },
    },
  );

  const builderTaskMutation = useAuthenticatedMutation(
    (client, id: string) => client.ensureSandboxCustomImageBuilderTask(id),
    {
      onSuccess: (image) => {
        onImageMutated(image);
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to open image builder session");
      },
    },
  );

  const deleteMutation = useAuthenticatedMutation(
    (client, id: string) => client.deleteSandboxCustomImage(id),
    {
      onSuccess: (_result, id) => {
        toast.success("Custom image deleted");
        queryClient.removeQueries({
          queryKey: sandboxCustomImageKeys.detail(id),
        });
        queryClient.invalidateQueries({
          queryKey: sandboxCustomImageKeys.list,
        });
        queryClient.invalidateQueries({ queryKey: sandboxEnvKeys.list });
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to delete custom image");
      },
    },
  );

  return {
    images: images ?? [],
    isLoading,
    customImagesEnabled,
    customImagesDisabled,
    createMutation,
    buildMutation,
    builderTaskMutation,
    deleteMutation,
  };
}
