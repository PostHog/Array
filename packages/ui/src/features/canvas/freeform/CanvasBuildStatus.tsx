import {
  CheckCircleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  hasActiveCanvasBuild,
  latestFinishedCanvasBuild,
} from "@posthog/core/canvas/canvasBuildSchemas";
import { useCanvasBuilds } from "@posthog/ui/features/canvas/hooks/useCanvasBuilds";
import { Flex, Text, Tooltip } from "@radix-ui/themes";

// Compact build indicator for the canvas toolbar: spinner while a queued
// publish builds, a quiet check once the live build is current, and the
// error diagnostics (in a tooltip) when the latest build failed — the canvas
// keeps rendering the last good build in that case.
export function CanvasBuildStatus({ dashboardId }: { dashboardId: string }) {
  const { lifecycle } = useCanvasBuilds(dashboardId);
  if (!lifecycle || lifecycle.builds.length === 0) return null;

  if (hasActiveCanvasBuild(lifecycle)) {
    return (
      <Flex align="center" gap="1">
        <SpinnerGapIcon size={14} className="animate-spin text-gray-9" />
        <Text size="1" className="text-gray-10">
          Building
        </Text>
      </Flex>
    );
  }

  const latest = latestFinishedCanvasBuild(lifecycle);
  if (!latest) return null;

  if (latest.buildStatus === "failed") {
    const errors = latest.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .slice(0, 3)
      .map((diagnostic) => diagnostic.message)
      .join("\n");
    return (
      <Tooltip
        content={`Latest build failed — the previous version stays live.\n${errors}`}
      >
        <Flex align="center" gap="1" data-testid="canvas-build-failed">
          <WarningCircleIcon size={14} className="text-red-9" />
          <Text size="1" className="text-red-10">
            Build failed
          </Text>
        </Flex>
      </Tooltip>
    );
  }

  if (lifecycle.publishedBuildId === latest.id) {
    return (
      <Tooltip content="The live build is up to date.">
        <Flex align="center" gap="1" data-testid="canvas-build-ready">
          <CheckCircleIcon size={14} className="text-green-9" />
        </Flex>
      </Tooltip>
    );
  }

  return null;
}
