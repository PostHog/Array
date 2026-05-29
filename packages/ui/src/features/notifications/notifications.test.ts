import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/utils/sounds", () => ({
  playCompletionSound: vi.fn(),
}));

import { playCompletionSound } from "@posthog/ui/utils/sounds";
import type {
  IActiveView,
  INotificationSettings,
  NotificationSettings,
} from "./identifiers";
import { TaskNotificationService } from "./notifications";

const TASK_ID = "task-123";
const OTHER_TASK_ID = "task-999";

function makeService(overrides?: {
  settings?: Partial<NotificationSettings>;
  hasFocus?: boolean;
  activeTaskId?: string;
}) {
  const notify = vi.fn();
  const showUnreadIndicator = vi.fn();
  const requestAttention = vi.fn();
  const play = vi.mocked(playCompletionSound);
  play.mockClear();

  const settings: NotificationSettings = {
    desktopNotifications: true,
    dockBadgeNotifications: true,
    dockBounceNotifications: true,
    completionSound: "meep",
    completionVolume: 80,
    ...overrides?.settings,
  };

  const settingsPort: INotificationSettings = { get: () => settings };
  const viewPort: IActiveView = {
    hasFocus: () => overrides?.hasFocus ?? false,
    getActiveTaskId: () => overrides?.activeTaskId,
  };

  const service = new TaskNotificationService(
    { notify, showUnreadIndicator, requestAttention },
    settingsPort,
    viewPort,
  );

  return { service, notify, showUnreadIndicator, requestAttention, play };
}

describe("TaskNotificationService", () => {
  describe("shouldNotify gating (via notifyPermissionRequest)", () => {
    const cases = [
      {
        name: "window unfocused → notifies",
        hasFocus: false,
        activeTaskId: TASK_ID,
        taskId: TASK_ID,
        shouldNotify: true,
      },
      {
        name: "focused on the same task → does not notify",
        hasFocus: true,
        activeTaskId: TASK_ID,
        taskId: TASK_ID,
        shouldNotify: false,
      },
      {
        name: "focused on a different task → notifies",
        hasFocus: true,
        activeTaskId: OTHER_TASK_ID,
        taskId: TASK_ID,
        shouldNotify: true,
      },
      {
        name: "focused, no active task → notifies",
        hasFocus: true,
        activeTaskId: undefined,
        taskId: TASK_ID,
        shouldNotify: true,
      },
      {
        name: "focused with no taskId supplied → does not notify",
        hasFocus: true,
        activeTaskId: undefined,
        taskId: undefined,
        shouldNotify: false,
      },
    ] as const;

    it.each(cases)(
      "$name",
      ({ hasFocus, activeTaskId, taskId, shouldNotify }) => {
        const { service, notify, play } = makeService({
          hasFocus,
          activeTaskId,
        });
        service.notifyPermissionRequest("My task", taskId);
        expect(notify).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
        expect(play).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
      },
    );
  });

  describe("notifyPromptComplete", () => {
    it.each([
      { stopReason: "tool_use", shouldNotify: false },
      { stopReason: "max_tokens", shouldNotify: false },
      { stopReason: "end_turn", shouldNotify: true },
    ])(
      "stop reason '$stopReason' → notifies=$shouldNotify",
      ({ stopReason, shouldNotify }) => {
        const { service, notify } = makeService({ hasFocus: false });
        service.notifyPromptComplete("My task", stopReason, TASK_ID);
        expect(notify).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
      },
    );
  });

  describe("settings gating", () => {
    it("skips desktop notification when desktopNotifications is off", () => {
      const { service, notify, showUnreadIndicator, requestAttention } =
        makeService({
          hasFocus: false,
          settings: { desktopNotifications: false },
        });
      service.notifyPermissionRequest("My task", TASK_ID);
      expect(notify).not.toHaveBeenCalled();
      expect(showUnreadIndicator).toHaveBeenCalledTimes(1);
      expect(requestAttention).toHaveBeenCalledTimes(1);
    });

    it("marks the notification silent when a custom sound plays", () => {
      const { service, notify } = makeService({
        hasFocus: false,
        settings: { completionSound: "meep" },
      });
      service.notifyPermissionRequest("My task", TASK_ID);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ silent: true }),
      );
    });

    it("is not silent when completionSound is none", () => {
      const { service, notify } = makeService({
        hasFocus: false,
        settings: { completionSound: "none" },
      });
      service.notifyPromptComplete("My task", "end_turn", TASK_ID);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ silent: false }),
      );
    });

    it("truncates long titles", () => {
      const { service, notify } = makeService({ hasFocus: false });
      const longTitle = "x".repeat(80);
      service.notifyPromptComplete(longTitle, "end_turn", TASK_ID);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          body: `"${"x".repeat(50)}..." finished`,
        }),
      );
    });
  });
});
