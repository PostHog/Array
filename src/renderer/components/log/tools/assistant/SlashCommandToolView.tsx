import { Box } from "@radix-ui/themes";
import { ToolCodeBlock } from "@renderer/components/log/tools/ToolUI";

interface SlashCommandToolViewProps {
  args: any;
  _unused?: {
    command: string;
  };
  result?: any;
}

export function SlashCommandToolView({ result }: SlashCommandToolViewProps) {
  return (
    <Box>
      {result && (
        <ToolCodeBlock maxLength={3000}>
          {typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2)}
        </ToolCodeBlock>
      )}
    </Box>
  );
}
