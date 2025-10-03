import { PlusIcon, QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import type { AgentDefinition } from "@shared/types";
import { StageFormItem } from "./StageFormItem";

export interface StageFormData {
  id: string;
  name: string;
  agentId: string | null;
}

interface WorkflowStagesStepProps {
  stages: StageFormData[];
  agents: AgentDefinition[];
  onAddStage: () => void;
  onRemoveStage: (index: number) => void;
  onUpdateStageName: (index: number, name: string) => void;
  onUpdateStageAgent: (index: number, agentName: string | null) => void;
}

export function WorkflowStagesStep({
  stages,
  agents,
  onAddStage,
  onRemoveStage,
  onUpdateStageName,
  onUpdateStageAgent,
}: WorkflowStagesStepProps) {
  return (
    <Flex direction="column" gap="3">
      <Flex justify="between" align="center">
        <Flex align="center" gap="1">
          <Text size="2" weight="medium">
            Stages
          </Text>
          <Tooltip content="Stages define the workflow steps tasks move through, either automated by an agent or requiring manual approval.">
            <QuestionMarkCircledIcon className="text-gray-9" />
          </Tooltip>
        </Flex>
        <Button size="1" variant="soft" onClick={onAddStage}>
          <PlusIcon /> Add stage
        </Button>
      </Flex>

      <Flex direction="column" gap="4">
        {stages.map((stage, index) => {
          const isComplete = index === stages.length - 1;
          const showDeleteButton = !isComplete;

          return (
            <StageFormItem
              key={stage.id}
              name={stage.name}
              agentId={stage.agentId}
              isComplete={isComplete}
              showDeleteButton={showDeleteButton}
              agents={agents}
              onNameChange={(name) => onUpdateStageName(index, name)}
              onAgentChange={(agentId) => onUpdateStageAgent(index, agentId)}
              onDelete={() => onRemoveStage(index)}
            />
          );
        })}
      </Flex>
    </Flex>
  );
}
