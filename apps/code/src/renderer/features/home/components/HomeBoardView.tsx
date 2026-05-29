import { Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import type { HomeSnapshot } from "../hooks/useHomeSnapshot";
import { buildBoardColumns } from "../utils/boardColumns";
import { HomeWorkstreamCard } from "./HomeWorkstreamCard";

interface HomeBoardViewProps {
  snapshot: HomeSnapshot;
}

export function HomeBoardView({ snapshot }: HomeBoardViewProps) {
  const columns = buildBoardColumns(
    snapshot.needsAttention,
    snapshot.inProgress,
  );

  return (
    <ScrollArea scrollbars="horizontal">
      <Flex gap="3" className="h-full min-h-0 p-4">
        {columns.map((column) => (
          <Flex
            key={column.id}
            direction="column"
            className="min-h-0 w-[300px] shrink-0"
          >
            <Box className="mb-2">
              <Flex align="baseline" justify="between" gap="2">
                <Text className="font-semibold text-[12px] text-gray-12 uppercase tracking-wide">
                  {column.title}
                </Text>
                <Text className="text-(--gray-10) text-[11px]">
                  {column.workstreams.length}
                </Text>
              </Flex>
              <Text className="text-(--gray-10) text-[11px]">
                {column.description}
              </Text>
            </Box>
            <Flex
              direction="column"
              gap="2"
              className="min-h-[120px] rounded-md bg-(--gray-2) p-2"
            >
              {column.workstreams.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-[100px] rounded-md border border-(--gray-4) border-dashed"
                >
                  <Text className="text-(--gray-9) text-[11px]">
                    Nothing here
                  </Text>
                </Flex>
              ) : (
                column.workstreams.map((ws) => (
                  <HomeWorkstreamCard key={ws.id} workstream={ws} />
                ))
              )}
            </Flex>
          </Flex>
        ))}
      </Flex>
    </ScrollArea>
  );
}
