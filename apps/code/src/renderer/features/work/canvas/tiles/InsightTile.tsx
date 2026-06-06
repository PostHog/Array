import { ArrowSquareOut, ChartLineUp } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  InsightTile as InsightTileType,
} from "@shared/types/work-projects";
import { openUrlInBrowser } from "@utils/browser";
import { TileFrame } from "../TileFrame";

interface InsightTileProps {
  tile: InsightTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
}

export function InsightTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
}: InsightTileProps) {
  return (
    <TileFrame
      tile={tile}
      icon={ChartLineUp}
      label={tile.dashboardId ? "PostHog dashboard" : "PostHog insight"}
      headerAction={
        <button
          type="button"
          onClick={() => openUrlInBrowser(tile.url)}
          className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
        >
          Open
          <ArrowSquareOut size={10} weight="bold" />
        </button>
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Flex direction="column" gap="2" className="px-4 py-3">
        <Text
          as="div"
          weight="medium"
          className="text-(--gray-12) text-[14px] leading-tight"
        >
          {tile.title}
        </Text>
        {tile.description && (
          <Text
            as="div"
            className="line-clamp-2 text-(--gray-11) text-[12px] leading-snug"
          >
            {tile.description}
          </Text>
        )}
        {tile.owner && (
          <Flex align="center" gap="2" className="mt-0.5">
            <Box
              className="flex h-4 w-4 items-center justify-center rounded-full bg-(--gray-4) text-(--gray-12) text-[8px] uppercase"
              title={tile.owner}
            >
              {tile.owner.slice(0, 1)}
            </Box>
            <Text as="span" className="text-(--gray-10) text-[11px]">
              {tile.owner}
            </Text>
          </Flex>
        )}
      </Flex>
    </TileFrame>
  );
}
