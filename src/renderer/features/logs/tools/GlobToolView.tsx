import { ToolCodeBlock, ToolMetadata } from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps, GlobArgs } from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { parseStringListResult, truncateList } from "@utils/tool-results";

type GlobToolViewProps = BaseToolViewProps<GlobArgs, string | string[]>;

export function GlobToolView({ args, result }: GlobToolViewProps) {
  const { path } = args;

  const files = parseStringListResult(result);

  return (
    <Box>
      {path && (
        <Box>
          <ToolMetadata>In: {path}</ToolMetadata>
        </Box>
      )}
      {files.length > 0 && (
        <Box mt={path ? "2" : "0"}>
          <ToolMetadata>
            Found {files.length} file{files.length === 1 ? "" : "s"}:
          </ToolMetadata>
          <ToolCodeBlock maxHeight="max-h-48">
            {truncateList(files, 50)}
          </ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
