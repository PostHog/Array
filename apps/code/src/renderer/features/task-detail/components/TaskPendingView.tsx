import { PendingChatView } from "@features/sessions/components/PendingChatView";
import { Flex } from "@radix-ui/themes";
import { usePendingTaskPrompt } from "@stores/pendingTaskPromptStore";

interface TaskPendingViewProps {
  pendingTaskKey: string;
}

export function TaskPendingView({ pendingTaskKey }: TaskPendingViewProps) {
  const pending = usePendingTaskPrompt(pendingTaskKey);

  return (
    <Flex direction="column" height="100%" className="relative bg-background">
      <PendingChatView promptText={pending?.promptText ?? ""} />
    </Flex>
  );
}
