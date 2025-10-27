import {
  ToolCodeBlock,
  ToolResultMessage,
  ToolSection,
} from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps, EditArgs } from "@features/logs/tools/types";
import { Badge, Box } from "@radix-ui/themes";

type EditToolViewProps = BaseToolViewProps<EditArgs, string>;

export function EditToolView({ args, result }: EditToolViewProps) {
  const { old_string, new_string, replace_all } = args;

  return (
    <Box>
      {replace_all && (
        <Box mb="2">
          <Badge size="1" color="blue">
            replace all
          </Badge>
        </Box>
      )}
      <Box className="space-y-2">
        <ToolSection label="Old:">
          <ToolCodeBlock color="red" maxHeight="max-h-32" maxLength={500}>
            {old_string}
          </ToolCodeBlock>
        </ToolSection>
        <ToolSection label="New:">
          <ToolCodeBlock color="green" maxHeight="max-h-32" maxLength={500}>
            {new_string}
          </ToolCodeBlock>
        </ToolSection>
      </Box>
      {result && (
        <Box mt="2">
          <ToolResultMessage>Edit applied successfully</ToolResultMessage>
        </Box>
      )}
    </Box>
  );
}
