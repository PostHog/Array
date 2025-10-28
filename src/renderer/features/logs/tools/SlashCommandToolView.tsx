import { ToolCodeBlock } from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  SlashCommandArgs,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";

type SlashCommandToolViewProps = BaseToolViewProps<
  SlashCommandArgs,
  string | Record<string, unknown>
>;

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
