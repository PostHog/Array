import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolCommandBlock,
  ToolResultMessage,
} from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  BashArgs,
  ShellResult,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { parseShellResult } from "@utils/tool-results";

type BashToolViewProps = BaseToolViewProps<BashArgs, string | ShellResult>;

export function BashToolView({ args, result }: BashToolViewProps) {
  const { command, timeout, run_in_background } = args;

  const { stdout, stderr, exitCode } = parseShellResult(result);

  return (
    <Box>
      <ToolBadgeGroup>
        <BadgeRenderer
          badges={[
            {
              condition: run_in_background,
              label: "background",
              color: "blue",
            },
            { condition: timeout, label: `${timeout}ms timeout` },
          ]}
        />
      </ToolBadgeGroup>
      <Box mt={run_in_background || timeout ? "2" : "0"}>
        <ToolCommandBlock command={command} />
      </Box>
      {(stdout || stderr) && (
        <Box mt="2">
          {stdout && <ToolCodeBlock maxLength={5000}>{stdout}</ToolCodeBlock>}
          {stderr && (
            <ToolCodeBlock color="red" maxHeight="max-h-32" maxLength={2000}>
              {stderr}
            </ToolCodeBlock>
          )}
          {exitCode !== undefined && exitCode !== 0 && (
            <Box mt="1">
              <ToolResultMessage success={false}>
                Exit code: {exitCode}
              </ToolResultMessage>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
