import { CheckCircle, Plus } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { Flex, Text } from "@radix-ui/themes";

interface HomeEmptyStateProps {
  hasRunningAgents: boolean;
}

export function HomeEmptyState({ hasRunningAgents }: HomeEmptyStateProps) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="3"
      className="h-full px-5 py-12"
    >
      <Flex
        align="center"
        justify="center"
        className="h-14 w-14 rounded-full bg-(--green-a3)"
      >
        <CheckCircle size={30} className="text-(--green-11)" weight="fill" />
      </Flex>
      <Text className="font-semibold text-[16px] text-gray-12">
        You're caught up
      </Text>
      <Text className="max-w-[360px] text-center text-(--gray-11) text-[13px]">
        {hasRunningAgents
          ? "Nothing else needs your attention. Your active agents are working."
          : "Nothing needs your attention right now. Start something new when you're ready."}
      </Text>
      {!hasRunningAgents ? (
        <Button variant="primary" size="sm" onClick={() => openTaskInput()}>
          <Plus size={12} />
          New task
        </Button>
      ) : null}
    </Flex>
  );
}
