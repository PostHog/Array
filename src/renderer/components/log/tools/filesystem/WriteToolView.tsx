import { Box } from "@radix-ui/themes";
import {
  ToolMetadata,
  ToolResultMessage,
} from "@renderer/components/log/tools/ToolUI";

interface WriteToolViewProps {
  args: any;
  _unused?: {
    file_path: string;
    content: string;
  };
  result?: any;
}

export function WriteToolView({ args, result }: WriteToolViewProps) {
  const { content } = args;
  const lineCount = content.split("\n").length;
  const charCount = content.length;

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
