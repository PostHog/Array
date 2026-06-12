import { RobotIcon } from "@phosphor-icons/react";
import { ConfigureAgentsSection } from "@posthog/ui/features/inbox/components/ConfigureAgentsSection";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";

export function AgentsView() {
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <RobotIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Agents"
        >
          Agents
        </Text>
      </Flex>
    ),
    [],
  );

  useSetHeaderContent(headerContent);

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="0.5"
        className="cursor-default select-none border-(--gray-5) border-b px-6 pt-5 pb-5"
      >
        <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
          Agents
        </Text>
        <Text className="max-w-3xl text-[12.5px] text-gray-11 leading-snug">
          Set up the agents that watch your product – which sources they read,
          which repos they ship to, who they loop in.
        </Text>
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <ConfigureAgentsSection />
        </div>
      </div>
    </Flex>
  );
}
