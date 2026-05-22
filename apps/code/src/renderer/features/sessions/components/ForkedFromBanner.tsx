import { GitBranch } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";

interface ForkedFromBannerProps {
  taskId: string;
}

export function ForkedFromBanner({ taskId }: ForkedFromBannerProps) {
  const trpc = useTRPC();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);

  const { data: relationship } = useQuery(
    trpc.fork.getForkRelationship.queryOptions({ taskId }),
  );

  if (!relationship) return null;

  const handleClick = () => {
    const placeholder: Task = {
      id: relationship.sourceTaskId,
      task_number: null,
      slug: "",
      title: relationship.sourceTaskTitle,
      description: "",
      origin_product: "user_created",
      created_at: "",
      updated_at: "",
    };
    navigateToTask(placeholder);
  };

  return (
    <Flex
      align="center"
      gap="1"
      px="3"
      py="1"
      className="shrink-0 border-(--gray-4) border-b bg-(--gray-2)"
    >
      <GitBranch size={12} className="shrink-0 text-(--gray-10)" />
      <Text size="1" color="gray">
        Forked from:
      </Text>
      <button
        type="button"
        onClick={handleClick}
        className="max-w-xs truncate text-(--accent-11) text-[12px] underline-offset-2 hover:underline"
      >
        {relationship.sourceTaskTitle}
      </button>
    </Flex>
  );
}
