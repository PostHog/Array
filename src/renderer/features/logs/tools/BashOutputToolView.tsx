import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolMetadata,
} from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  BashOutputArgs,
  ShellStatus,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";

type BashOutputToolViewProps = BaseToolViewProps<
  BashOutputArgs,
  string | ShellStatus
>;

export function BashOutputToolView({ args, result }: BashOutputToolViewProps) {
  const { filter } = args;

  // Parse result
  let stdout = "";
  let stderr = "";
  let status: string | undefined;

  if (result) {
    if (typeof result === "string") {
      stdout = result;
    } else if (typeof result === "object") {
      stdout = result.stdout || "";
      stderr = result.stderr || "";
      status = result.status;
    }
  }

  return (
    <Box>
      <ToolBadgeGroup>
        <BadgeRenderer
          badges={[
            {
              condition: status,
              label: status,
              color: status === "running" ? "blue" : "gray",
            },
          ]}
        />
      </ToolBadgeGroup>
      {filter && (
        <Box mt="1">
          <ToolMetadata>Filter: {filter}</ToolMetadata>
        </Box>
      )}
      {(stdout || stderr) && (
        <Box mt="2">
          {stdout && <ToolCodeBlock maxLength={5000}>{stdout}</ToolCodeBlock>}
          {stderr && (
            <ToolCodeBlock color="red" maxHeight="max-h-32">
              {stderr}
            </ToolCodeBlock>
          )}
        </Box>
      )}
    </Box>
  );
}
