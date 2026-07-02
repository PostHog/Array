import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { CHANNEL_TASK_SUGGESTIONS } from "@posthog/ui/features/canvas/channelTaskSuggestions";
import { ChannelHeader } from "@posthog/ui/features/canvas/components/ChannelHeader";
import {
  ChannelHomeComposer,
  type ChannelHomeComposerHandle,
} from "@posthog/ui/features/canvas/components/ChannelHomeComposer";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { SuggestedPromptCard } from "@posthog/ui/features/task-detail/components/SuggestedPromptCard";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";

// A channel's homepage: a heading and a composer that files new tasks into the
// channel. The channel's tasks + canvases live behind the "History" tab.
export function WebsiteChannelHome({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { fileTask } = useChannelTaskMutations();

  const { data: instructions } = useFolderInstructions(channelId);
  const channelContext = instructions?.content;

  useSetHeaderContent(
    useMemo(() => <ChannelHeader channelId={channelId} />, [channelId]),
  );

  const composerRef = useRef<ChannelHomeComposerHandle>(null);

  const handleSuggestionSelect = useCallback(
    (prompt: string, mode?: string) => {
      composerRef.current?.applySuggestion(prompt, mode);
    },
    [],
  );

  const onTaskCreated = useCallback(
    (task: Task) => {
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      void fileTask(channelId, task.id, task.title)
        .then(() =>
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: true,
          }),
        )
        .catch((error: unknown) => {
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: false,
          });
          toast.error("Couldn't file task to channel", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId: task.id },
      });
    },
    [channelId, fileTask, navigate, queryClient],
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center gap-6 px-4 py-10">
        <div className="text-center">
          <h1 className="font-semibold text-2xl text-gray-12 tracking-tight">
            What can I do for you today?
          </h1>
          <Text className="mt-2 block text-[13px] text-gray-10">
            Ask anything, kick off a task, or pick up where you left off.
          </Text>
        </div>

        {/* Starter prompts, always shown directly above the box. */}
        <div className="flex flex-col gap-2">
          <Text size="1" weight="medium" className="px-1 text-(--gray-11)">
            Suggestions
          </Text>
          <div className="grid grid-cols-2 gap-2">
            {CHANNEL_TASK_SUGGESTIONS.map((suggestion) => (
              <SuggestedPromptCard
                key={suggestion.label}
                suggestion={suggestion}
                onSelect={() =>
                  handleSuggestionSelect(suggestion.prompt, suggestion.mode)
                }
              />
            ))}
          </div>
        </div>

        <ChannelHomeComposer
          ref={composerRef}
          channelId={channelId}
          channelName={channelName}
          channelContext={channelContext}
          onTaskCreated={onTaskCreated}
        />
      </div>
    </div>
  );
}
