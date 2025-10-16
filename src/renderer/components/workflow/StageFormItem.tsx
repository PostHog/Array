import { Cross2Icon } from "@radix-ui/react-icons";
import { Box, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { Combobox } from "@renderer/components/Combobox";
import type { AgentDefinition } from "@shared/types";

interface StageFormItemProps {
  name: string;
  agentId: string | null;
  isComplete: boolean;
  showDeleteButton: boolean;
  agents: AgentDefinition[];
  onNameChange: (name: string) => void;
  onAgentChange: (agentId: string | null) => void;
  onDelete: () => void;
}

export function StageFormItem({
  name,
  agentId,
  isComplete,
  showDeleteButton,
  agents,
  onNameChange,
  onAgentChange,
  onDelete,
}: StageFormItemProps) {
  const agentItems = [
    { value: "__none__", label: "No agent (manual)" },
    ...agents.map((agent) => ({
      value: agent.id,
      label: agent.name,
    })),
  ];

  return (
    <Box>
      <Flex gap="2" align="center">
        <Flex
          direction="column"
          gap="2"
          flexGrow="1"
          style={{ minWidth: 0 }}
          mr={!showDeleteButton ? "7" : undefined}
        >
          <TextField.Root
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Stage name..."
            size="2"
            disabled={isComplete}
          />
          {!isComplete && (
            <Combobox
              items={agentItems}
              value={agentId || "__none__"}
              onValueChange={(value) =>
                onAgentChange(value === "__none__" ? null : value)
              }
              placeholder="Select agent..."
              searchPlaceholder="Search agents..."
              emptyMessage="No agents found"
              size="2"
            />
          )}
          {isComplete && (
            <Text size="1" color="gray">
              No agent required
            </Text>
          )}
        </Flex>
        {showDeleteButton && (
          <IconButton variant="ghost" color="gray" onClick={onDelete} mx="2">
            <Cross2Icon />
          </IconButton>
        )}
      </Flex>
    </Box>
  );
}
