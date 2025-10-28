import { ToolResultMessage } from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  KillShellArgs,
  KillShellResult,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { parseKillShellResult } from "@utils/tool-results";

type KillShellToolViewProps = BaseToolViewProps<
  KillShellArgs,
  string | KillShellResult
>;

export function KillShellToolView({ result }: KillShellToolViewProps) {
  const { success, message } = parseKillShellResult(result);

  return (
    <Box>
      {result && (
        <ToolResultMessage success={success}>
          {message || (success ? "Shell terminated" : "Failed to terminate")}
        </ToolResultMessage>
      )}
    </Box>
  );
}
