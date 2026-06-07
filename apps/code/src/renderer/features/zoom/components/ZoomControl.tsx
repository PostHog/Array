import { useZoomActions, useZoomState } from "@features/zoom/hooks/useZoom";
import { Minus, Plus } from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";

export function ZoomControl() {
  const state = useZoomState();
  const { zoomIn, zoomOut, reset } = useZoomActions();

  return (
    <Flex align="center" gap="2">
      <Button
        size="1"
        variant="soft"
        onClick={zoomOut}
        disabled={!state.canZoomOut}
        aria-label="Zoom out"
      >
        <Minus size={12} />
      </Button>
      <Text color="gray" className="min-w-[44px] text-center text-[13px]">
        {state.percent}%
      </Text>
      <Button
        size="1"
        variant="soft"
        onClick={zoomIn}
        disabled={!state.canZoomIn}
        aria-label="Zoom in"
      >
        <Plus size={12} />
      </Button>
      <Button
        size="1"
        variant="outline"
        onClick={reset}
        disabled={state.level === 0}
      >
        Reset
      </Button>
    </Flex>
  );
}
