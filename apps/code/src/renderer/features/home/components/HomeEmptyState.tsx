import { CheckCircle, Plus } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";

interface HomeEmptyStateProps {
  hasRunningAgents: boolean;
}

export function HomeEmptyState({ hasRunningAgents }: HomeEmptyStateProps) {
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="3"
      className="h-full px-5 py-12"
    >
      <CheckCircle size={36} className="text-(--green-9)" weight="duotone" />
      <Text className="font-medium text-[15px] text-gray-12">
        You're caught up
      </Text>
      <Text className="max-w-[360px] text-center text-(--gray-11) text-[13px]">
        {hasRunningAgents
          ? "Nothing else needs your attention. Your active agents are working."
          : "Nothing needs your attention right now. Start something new when you're ready."}
      </Text>
      {!hasRunningAgents ? (
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigateToTaskInput()}
        >
          <Plus size={12} />
          New task
        </Button>
      ) : null}
    </Flex>
  );
}
