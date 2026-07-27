import type { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskActivityContribution } from "./taskActivity.contribution";

let completionListener: ((taskId?: string) => void) | undefined;
const notificationBus = {
  subscribeToTaskCompletion: vi.fn((listener: (taskId?: string) => void) => {
    completionListener = listener;
    return vi.fn();
  }),
} as unknown as NotificationBus;

describe("TaskActivityContribution", () => {
  let queryClient: QueryClient;
  let contribution: TaskActivityContribution;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryClient = new QueryClient();
    contribution = new TaskActivityContribution(notificationBus, queryClient);
    contribution.start();
  });

  afterEach(() => vi.useRealTimers());

  it("refreshes activity immediately and reconciles after session completion", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    completionListener?.("task-1");
    expect(invalidate).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(2_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
