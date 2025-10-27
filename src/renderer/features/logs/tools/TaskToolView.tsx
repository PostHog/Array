import {
  ToolBadgeGroup,
  ToolCodeBlock,
  ToolSection,
} from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps, TaskArgs } from "@features/logs/tools/types";
import { Badge, Box, Code } from "@radix-ui/themes";

type TaskToolViewProps = BaseToolViewProps<
  TaskArgs,
  string | Record<string, unknown>
>;

export function TaskToolView({ args, result }: TaskToolViewProps) {
  const { description, prompt, subagent_type } = args;

  return (
    <Box>
      <ToolBadgeGroup>
        <Badge size="1" color="blue">
          {subagent_type}
        </Badge>
      </ToolBadgeGroup>
      <Box mt="1">
        <Code size="2" variant="ghost">
          {description}
        </Code>
      </Box>
      <Box mt="2">
        <ToolSection label="Prompt:">
          <ToolCodeBlock maxHeight="max-h-48" maxLength={1000}>
            {prompt}
          </ToolCodeBlock>
        </ToolSection>
      </Box>
      {result && (
        <Box mt="2">
          <ToolSection label="Agent result:">
            <ToolCodeBlock maxLength={3000}>
              {typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2)}
            </ToolCodeBlock>
          </ToolSection>
        </Box>
      )}
    </Box>
  );
}
