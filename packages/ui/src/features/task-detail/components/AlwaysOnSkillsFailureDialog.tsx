import { Warning } from "@phosphor-icons/react";
import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import { useAlwaysOnSkillsFailureStore } from "../stores/alwaysOnSkillsFailureStore";

export function AlwaysOnSkillsFailureDialog() {
  const isOpen = useAlwaysOnSkillsFailureStore((state) => state.isOpen);
  const error = useAlwaysOnSkillsFailureStore((state) => state.error);
  const skills = useAlwaysOnSkillsFailureStore((state) => state.skills);
  const choose = useAlwaysOnSkillsFailureStore((state) => state.choose);

  return (
    <AlertDialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) choose("cancel");
      }}
    >
      <AlertDialog.Content maxWidth="520px" size="2">
        <AlertDialog.Title className="text-base">
          <Flex align="center" gap="2">
            <Warning size={18} weight="bold" color="var(--amber-9)" />
            Always-on skills could not be loaded
          </Flex>
        </AlertDialog.Title>
        <AlertDialog.Description>
          {skills.map((skill) => skill.name).join(", ")}
        </AlertDialog.Description>
        <Text as="p" size="2" color="gray" mt="2">
          {error}
        </Text>
        <Flex justify="end" gap="2" mt="4" wrap="wrap">
          <Button
            variant="soft"
            color="gray"
            size="1"
            onClick={() => choose("cancel")}
          >
            Cancel
          </Button>
          <Button
            variant="soft"
            color="gray"
            size="1"
            onClick={() => choose("continue")}
          >
            Continue once
          </Button>
          <Button
            variant="soft"
            color="red"
            size="1"
            onClick={() => choose("disable")}
          >
            Disable and continue
          </Button>
          <Button variant="solid" size="1" onClick={() => choose("retry")}>
            Retry
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
