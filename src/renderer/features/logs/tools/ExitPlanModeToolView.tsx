import {
  ToolCodeBlock,
  ToolResultMessage,
  ToolSection,
} from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  ExitPlanModeArgs,
} from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";

type ExitPlanModeToolViewProps = BaseToolViewProps<ExitPlanModeArgs, string>;

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
