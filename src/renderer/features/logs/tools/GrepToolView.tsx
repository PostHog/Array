import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolMetadata,
} from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  GrepArgs,
  GrepResult,
} from "@features/logs/tools/types";
import { Badge, Box, Code } from "@radix-ui/themes";
import { parseStringListResult, truncateList } from "@utils/tool-results";

type GrepToolViewProps = BaseToolViewProps<GrepArgs, string | GrepResult>;

export function GrepToolView({ args, result }: GrepToolViewProps) {
  const { path, glob, type, output_mode, head_limit, multiline } = args;
  const caseInsensitive = args["-i"];
  const showLineNumbers = args["-n"];
  const contextAfter = args["-A"];
  const contextBefore = args["-B"];
  const contextAround = args["-C"];

  // Parse result
  let matches: string[] = [];
  let count: number | undefined;

  if (result) {
    if (typeof result === "string") {
      matches = parseStringListResult(result);
    } else if (typeof result === "object") {
      matches = result.matches || [];
      count = result.count;
    }
  }

  return (
    <Box>
      <ToolBadgeGroup className="flex-wrap">
        {output_mode && (
          <Badge size="1" color="blue">
            {output_mode}
          </Badge>
        )}
        {caseInsensitive && (
          <Badge size="1" color="gray">
            case-insensitive
          </Badge>
        )}
        {showLineNumbers && (
          <Badge size="1" color="gray">
            line numbers
          </Badge>
        )}
        {multiline && (
          <Badge size="1" color="purple">
            multiline
          </Badge>
        )}
        {contextAfter && (
          <Badge size="1" color="gray">
            +{contextAfter} after
          </Badge>
        )}
        {contextBefore && (
          <Badge size="1" color="gray">
            -{contextBefore} before
          </Badge>
        )}
        {contextAround && (
          <Badge size="1" color="gray">
            ±{contextAround}
          </Badge>
        )}
        {glob && (
          <Badge size="1" color="green">
            {glob}
          </Badge>
        )}
        {type && (
          <Badge size="1" color="green">
            {type}
          </Badge>
        )}
      </ToolBadgeGroup>
      {path && (
        <Box mt="1">
          <ToolMetadata>In: {path}</ToolMetadata>
        </Box>
      )}
      {count !== undefined && (
        <Box mt="2">
          <Code size="2" variant="soft">
            {count} matches
          </Code>
        </Box>
      )}
      {matches.length > 0 && (
        <Box mt="2">
          <ToolMetadata>
            {matches.length} result{matches.length === 1 ? "" : "s"}
            {head_limit && ` (limited to ${head_limit})`}:
          </ToolMetadata>
          <ToolCodeBlock maxHeight="max-h-96">
            {truncateList(matches, 100)}
          </ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
