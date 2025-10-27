import { ToolResultMessage } from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  KillShellArgs,
  KillShellResult,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";

type KillShellToolViewProps = BaseToolViewProps<
  KillShellArgs,
  string | KillShellResult
>;

export function KillShellToolView({ result }: KillShellToolViewProps) {
  let success = false;
  let message = "";

  if (result) {
    if (typeof result === "string") {
      message = result;
      success = result.includes("killed") || result.includes("terminated");
    } else if (typeof result === "object") {
      success = result.success || false;
      message = result.message || "";
    }
  }

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
