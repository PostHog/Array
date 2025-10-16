import { Box } from "@radix-ui/themes";
import {
  ToolCodeBlock,
  ToolResultMessage,
  ToolSection,
} from "@renderer/components/log/tools/ToolUI";

interface ExitPlanModeToolViewProps {
  args: any;
  _unused?: {
    plan: string;
  };
  result?: any;
}

export function ExitPlanModeToolView({
  args,
  result,
}: ExitPlanModeToolViewProps) {
  const { plan } = args;

  return (
    <Box>
      <ToolSection label="Plan:">
        <ToolCodeBlock maxLength={2000}>{plan}</ToolCodeBlock>
      </ToolSection>
      {result && (
        <Box mt="2">
          <ToolResultMessage>Exited plan mode</ToolResultMessage>
        </Box>
      )}
    </Box>
  );
}
