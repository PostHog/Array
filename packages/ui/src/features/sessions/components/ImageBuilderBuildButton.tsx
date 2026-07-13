import {
  isImageBuildFailed,
  isImageBuildInProgress,
} from "@posthog/shared/domain-types";
import { imageFailureDetail } from "@posthog/ui/features/settings/sections/environments/imageBuildWatcher";
import { useSandboxCustomImages } from "@posthog/ui/features/settings/sections/environments/useSandboxCustomImages";
import { Button, Flex, Text } from "@radix-ui/themes";

export function ImageBuilderBuildButton({ taskId }: { taskId: string }) {
  const { images, buildMutation } = useSandboxCustomImages();
  const image = images.find((img) => img.builder_task_id === taskId);
  if (!image) return null;

  const inProgress = isImageBuildInProgress(image.status);
  const isFailed = isImageBuildFailed(image.status);

  return (
    <Flex align="center" gap="2" className="shrink-0">
      {inProgress ? (
        <Text color="gray" className="text-[12px]">
          {image.status === "scanning" ? "scanning…" : "building…"}
        </Text>
      ) : image.status === "ready" ? (
        <Text color="green" className="text-[12px]">
          ready · v{image.version}
        </Text>
      ) : isFailed ? (
        <Text
          color="red"
          className="text-[12px]"
          title={imageFailureDetail(image)}
        >
          {image.status === "scan_failed" ? "scan failed" : "build failed"}
        </Text>
      ) : null}
      <Button
        size="1"
        variant="soft"
        onClick={() => buildMutation.mutate({ id: image.id })}
        loading={buildMutation.isPending}
        disabled={inProgress || buildMutation.isPending}
      >
        Save & build
      </Button>
    </Flex>
  );
}
