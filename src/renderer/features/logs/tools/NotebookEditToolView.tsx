import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
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
import { Box } from "@radix-ui/themes";

type NotebookEditToolViewProps = BaseToolViewProps<NotebookEditArgs, string>;

export function NotebookEditToolView({
  args,
  result,
}: NotebookEditToolViewProps) {
  const { cell_id, cell_type, edit_mode, new_source } = args;

  return (
    <Box>
      <ToolBadgeGroup>
        <BadgeRenderer
          badges={[
            { condition: edit_mode, label: edit_mode, color: "blue" },
            { condition: cell_type, label: cell_type },
          ]}
        />
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
