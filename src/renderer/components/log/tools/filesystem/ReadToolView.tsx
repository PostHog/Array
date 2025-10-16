import { Box } from "@radix-ui/themes";
import { ToolCodeBlock, ToolMetadata } from "../ToolUI";

interface ReadToolViewProps {
  args: any;
  result?: any;
}

export function ReadToolView({ args, result }: ReadToolViewProps) {
  const { offset, limit } = args;
  const isPartialRead = offset !== undefined || limit !== undefined;

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
      {result && (
        <Box mt={isPartialRead ? "2" : "0"}>
          <ToolCodeBlock maxHeight="max-h-96">
            {typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2)}
          </ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
