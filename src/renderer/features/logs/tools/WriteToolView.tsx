import { ToolMetadata, ToolResultMessage } from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps, WriteArgs } from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";

type WriteToolViewProps = BaseToolViewProps<WriteArgs, string>;

export function WriteToolView({ args, result }: WriteToolViewProps) {
  const { content } = args;
  const lineCount = content ? content.split("\n").length : 0;
  const charCount = content ? content.length : 0;

  return (
    <Box>
      <ToolMetadata>
        {lineCount} lines • {charCount} characters
      </ToolMetadata>
      {result && (
        <Box mt="2">
          <ToolResultMessage>File written successfully</ToolResultMessage>
        </Box>
      )}
    </Box>
  );
}
