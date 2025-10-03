import { Flex, Text, TextArea, TextField } from "@radix-ui/themes";

interface WorkflowBasicInfoStepProps {
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
}

export function WorkflowBasicInfoStep({
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: WorkflowBasicInfoStepProps) {
  return (
    <>
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Name
        </Text>
        <TextField.Root
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Workflow name..."
          size="2"
          autoFocus
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Description (optional)
        </Text>
        <TextArea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Add description..."
          size="2"
          rows={2}
        />
      </Flex>
    </>
  );
}
