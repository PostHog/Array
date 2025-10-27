import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolMetadata,
  ToolResultMessage,
  ToolSection,
} from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  NotebookEditArgs,
} from "@features/logs/tools/types";
import { Badge, Box } from "@radix-ui/themes";

type NotebookEditToolViewProps = BaseToolViewProps<NotebookEditArgs, string>;

export function NotebookEditToolView({
  args,
  result,
}: NotebookEditToolViewProps) {
  const { cell_id, cell_type, edit_mode, new_source } = args;

  return (
    <Box>
      <ToolBadgeGroup>
        {edit_mode && (
          <Badge size="1" color="blue">
            {edit_mode}
          </Badge>
        )}
        {cell_type && (
          <Badge size="1" color="gray">
            {cell_type}
          </Badge>
        )}
        {cell_id && <ToolMetadata>Cell: {cell_id.slice(0, 8)}</ToolMetadata>}
      </ToolBadgeGroup>
      {edit_mode !== "delete" && new_source && (
        <Box mt="2">
          <ToolSection label="New content:">
            <ToolCodeBlock maxHeight="max-h-48" maxLength={500}>
              {new_source}
            </ToolCodeBlock>
          </ToolSection>
        </Box>
      )}
      {result && (
        <Box mt="2">
          <ToolResultMessage>Notebook updated successfully</ToolResultMessage>
        </Box>
      )}
    </Box>
  );
}
