import { Box } from "@radix-ui/themes";
import { ToolResultMessage } from "@renderer/components/log/tools/ToolUI";

interface KillShellToolViewProps {
  args: any;
  _unused?: {
    shell_id: string;
  };
  result?: string | { success?: boolean; message?: string };
}

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
