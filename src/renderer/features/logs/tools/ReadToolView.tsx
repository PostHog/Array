import { ToolCodeBlock, ToolMetadata } from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps } from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { getNumber } from "@utils/arg-extractors";

type ReadToolViewProps = BaseToolViewProps<Record<string, unknown>, unknown>;

export function ReadToolView({ args, result }: ReadToolViewProps) {
  const offset = getNumber(args, "offset");
  const limit = getNumber(args, "limit");
  const isPartialRead = offset !== undefined || limit !== undefined;

  const resultText: string | undefined = result
    ? typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2)
    : undefined;

  return (
    <Box>
      {isPartialRead && (
        <Box>
          <ToolMetadata>
            {offset !== undefined && `Starting at line ${offset}`}
            {offset !== undefined && limit !== undefined && " • "}
            {limit !== undefined && `Reading ${limit} lines`}
          </ToolMetadata>
        </Box>
      )}
      {resultText && (
        <Box mt={isPartialRead ? "2" : "0"}>
          <ToolCodeBlock maxHeight="max-h-96">{resultText}</ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
