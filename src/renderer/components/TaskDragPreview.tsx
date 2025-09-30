import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import type { ForwardedRef } from "react";
import { forwardRef } from "react";

interface TaskDragPreviewProps {
  status: string;
  title: string;
}

export const TaskDragPreview = forwardRef(
  (
    { status, title }: TaskDragPreviewProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    return (
      <Box
        ref={ref}
        position="fixed"
        style={{
          // Painful hack to position it out of the screen, hiding doesn't work
          top: "-10000px",
          left: "-10000px",
          pointerEvents: "none",
        }}
      >
        <Flex
          gap="2"
          align="center"
          p="2"
          className="border border-gray-6 bg-panel-solid font-mono"
          style={{ borderRadius: "var(--radius-2)" }}
        >
          <Badge color={status === "Backlog" ? "gray" : undefined} size="1">
            {status}
          </Badge>
          <Text size="2">{title}</Text>
        </Flex>
      </Box>
    );
  },
);

TaskDragPreview.displayName = "TaskDragPreview";
