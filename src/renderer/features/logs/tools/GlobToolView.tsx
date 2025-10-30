import { ToolCodeBlock, ToolMetadata } from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps } from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { getStringOrUndefined } from "@utils/arg-extractors";
import { parseStringListResult, truncateList } from "@utils/tool-results";

type GlobToolViewProps = BaseToolViewProps<Record<string, unknown>, unknown>;

export function GlobToolView({ args, result }: GlobToolViewProps) {
  const path = getStringOrUndefined(args, "path");

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
