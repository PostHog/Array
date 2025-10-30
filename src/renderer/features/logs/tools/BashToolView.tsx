import { useLogsStore } from "@features/logs/stores/logsStore";
import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolCommandBlock,
  ToolResultMessage,
} from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  ShellResult,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { getBoolean, getNumber, getString } from "@utils/arg-extractors";
import { parseShellResult } from "@utils/tool-results";

type TerminalResult = {
  type: "terminal";
  terminalId: string;
};

type BashToolViewProps = BaseToolViewProps<Record<string, unknown>, unknown>;

export function BashToolView({ args, result }: BashToolViewProps) {
  const command = getString(args, "command");
  const timeout = getNumber(args, "timeout");
  const run_in_background = getBoolean(args, "run_in_background");

  // Check if result is a terminal reference (ACP format)
  const isTerminal =
    result &&
    typeof result === "object" &&
    "type" in result &&
    result.type === "terminal";

  // Subscribe to terminal output changes for this specific terminal
  const terminalOutput = useLogsStore((state) => {
    if (!isTerminal) return undefined;
    const terminalResult = result as TerminalResult;
    return state.getTerminalOutput(terminalResult.terminalId);
  });

  if (isTerminal) {
    const terminalResult = result as TerminalResult;

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
        {terminalOutput ? (
          <Box mt="2">
            <ToolCodeBlock maxLength={5000}>
              {terminalOutput.output}
            </ToolCodeBlock>
            {terminalOutput.exitCode !== undefined &&
              terminalOutput.exitCode !== 0 && (
                <Box mt="1">
                  <ToolResultMessage success={false}>
                    Exit code: {terminalOutput.exitCode}
                  </ToolResultMessage>
                </Box>
              )}
          </Box>
        ) : (
          <Box mt="2">
            <ToolResultMessage>
              Terminal: {terminalResult.terminalId}
            </ToolResultMessage>
          </Box>
        )}
      </Box>
    );
  }

  // Legacy format: parse stdout/stderr/exitCode
  const legacyResult: string | ShellResult | undefined = result as
    | string
    | ShellResult
    | undefined;
  const { stdout, stderr, exitCode } = parseShellResult(legacyResult);

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
