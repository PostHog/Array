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
import { Badge, Box } from "@radix-ui/themes";

type BashToolViewProps = BaseToolViewProps<BashArgs, string | ShellResult>;

export function BashToolView({ args, result }: BashToolViewProps) {
  const { command, timeout, run_in_background } = args;

  // Parse result
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;

  if (result) {
    if (typeof result === "string") {
      stdout = result;
    } else if (typeof result === "object") {
      stdout = result.stdout || "";
      stderr = result.stderr || "";
      exitCode = result.exitCode;
    }
  }

  return (
    <Box>
      <ToolBadgeGroup>
        {run_in_background && (
          <Badge size="1" color="blue">
            background
          </Badge>
        )}
        {timeout && (
          <Badge size="1" color="gray">
            {timeout}ms timeout
          </Badge>
        )}
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
