import type { Task } from "@posthog/shared/domain-types";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { taskInputProps } = vi.hoisted(() => ({
  taskInputProps: {} as Record<string, unknown>,
}));

vi.mock("@posthog/ui/features/task-detail/components/TaskInput", () => ({
  TaskInput: (props: Record<string, unknown>) => {
    Object.assign(taskInputProps, props);
    return <div>Task input</div>;
  },
}));

import { ChannelCreateTaskDialog } from "./ChannelCreateTaskDialog";

describe("ChannelCreateTaskDialog", () => {
  it("creates the task in the backend channel and closes on success", () => {
    const onOpenChange = vi.fn();
    const onTaskCreated = vi.fn();
    render(
      <ChannelCreateTaskDialog
        open
        channelId="feed-channel-id"
        channelContextId="folder-channel-id"
        channelName="code"
        channelContext="# code"
        onOpenChange={onOpenChange}
        onTaskCreated={onTaskCreated}
      />,
    );

    expect(taskInputProps).toMatchObject({
      channelId: "feed-channel-id",
      channelContextId: "folder-channel-id",
      channelName: "code",
      channelContext: "# code",
    });

    const task = { id: "task-1" } as Task;
    (taskInputProps.onTaskCreated as (createdTask: Task) => void)(task);

    expect(onTaskCreated).toHaveBeenCalledWith(task);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
