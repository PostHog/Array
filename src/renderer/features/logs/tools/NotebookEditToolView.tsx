import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolMetadata,
  ToolResultMessage,
  ToolSection,
} from "@features/logs/tools/ToolUI";
import { Badge, Box } from "@radix-ui/themes";

interface NotebookEditToolViewProps {
  args: any;
  _unused?: {
    notebook_path: string;
    cell_id?: string;
    cell_type?: "code" | "markdown";
    edit_mode?: "replace" | "insert" | "delete";
    new_source: string;
  };
  result?: any;
}

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
