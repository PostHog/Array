import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolMetadata,
} from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps } from "@features/logs/tools/types";
import { Box, Code } from "@radix-ui/themes";
import {
  getBooleanOrUndefined,
  getNumber,
  getStringOrUndefined,
} from "@utils/arg-extractors";
import {
  type GrepResultParsed,
  parseGrepResult,
  truncateList,
} from "@utils/tool-results";

type GrepToolViewProps = BaseToolViewProps<Record<string, unknown>, unknown>;

export function GrepToolView({ args, result }: GrepToolViewProps) {
  const path = getStringOrUndefined(args, "path");
  const glob = getStringOrUndefined(args, "glob");
  const type = getStringOrUndefined(args, "type");
  const output_mode = getStringOrUndefined(args, "output_mode");
  const head_limit = getNumber(args, "head_limit");
  const multiline = getBooleanOrUndefined(args, "multiline");
  const caseInsensitive = getBooleanOrUndefined(args, "-i");
  const showLineNumbers = getBooleanOrUndefined(args, "-n");
  const contextAfter = getNumber(args, "-A");
  const contextBefore = getNumber(args, "-B");
  const contextAround = getNumber(args, "-C");

  const { matches, count } = parseGrepResult(
    result as string | Partial<GrepResultParsed> | undefined,
  );

  return (
    <Box>
      <ToolBadgeGroup className="flex-wrap">
        <BadgeRenderer
          badges={[
            { condition: output_mode, label: output_mode, color: "blue" },
            { condition: caseInsensitive, label: "case-insensitive" },
            { condition: showLineNumbers, label: "line numbers" },
            { condition: multiline, label: "multiline", color: "purple" },
            { condition: contextAfter, label: `+${contextAfter} after` },
            { condition: contextBefore, label: `-${contextBefore} before` },
            { condition: contextAround, label: `±${contextAround}` },
            { condition: glob, label: glob, color: "green" },
            { condition: type, label: type, color: "green" },
          ]}
        />
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
