import { Badge, Box } from "@radix-ui/themes";
import { ToolBadgeGroup, ToolCodeBlock, ToolMetadata } from "./ToolUI";

interface BashOutputToolViewProps {
  args: any;
  _unused?: {
    bash_id: string;
    filter?: string;
  };
  result?: string | { stdout?: string; stderr?: string; status?: string };
}

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
        {status && (
          <Badge size="1" color={status === "running" ? "blue" : "gray"}>
            {status}
          </Badge>
        )}
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
