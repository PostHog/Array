import "reflect-metadata";
import type { NotificationTarget } from "@posthog/platform/notifications";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/utils/sounds", () => ({
  playCompletionSound: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@posthog/ui/primitives/toast", () => ({ toast: toastMock }));

import { playCompletionSound } from "@posthog/ui/utils/sounds";
import type {
  IActiveView,
  INotificationSettings,
  NotificationSettings,
} from "./identifiers";
import { NotificationBus } from "./notifications";

const TASK_ID = "task-123";
const OTHER_TASK_ID = "task-999";
const taskTarget = (id: string): NotificationTarget => ({
  kind: "task",
  taskId: id,
});

function makeBus(overrides?: {
  settings?: Partial<NotificationSettings>;
  hasFocus?: boolean;
  activeTarget?: NotificationTarget;
}) {
  const notify = vi.fn();
  const showUnreadIndicator = vi.fn();
  const requestAttention = vi.fn();
  const play = vi.mocked(playCompletionSound);
  play.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();

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
    getActiveTarget: () => overrides?.activeTarget,
  };

  const bus = new NotificationBus(
    { notify, showUnreadIndicator, requestAttention },
    settingsPort,
    viewPort,
  );

  return { bus, notify, showUnreadIndicator, requestAttention, play };
}

describe("NotificationBus tier routing (via notifyPermissionRequest)", () => {
  it("app unfocused → native notification", () => {
    const { bus, notify } = makeBus({
      hasFocus: false,
      activeTarget: taskTarget(TASK_ID),
    });
    bus.notifyPermissionRequest("My task", TASK_ID);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("focused on the same task → suppressed (nothing)", () => {
    const { bus, notify, play } = makeBus({
      hasFocus: true,
      activeTarget: taskTarget(TASK_ID),
    });
    bus.notifyPermissionRequest("My task", TASK_ID);
    expect(notify).not.toHaveBeenCalled();
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it.each([
    ["viewing a different task", taskTarget(OTHER_TASK_ID)],
    ["viewing nothing relevant", undefined],
  ])("focused, %s → in-app toast (not native)", (_label, activeTarget) => {
    const { bus, notify } = makeBus({ hasFocus: true, activeTarget });
    bus.notifyPermissionRequest("My task", TASK_ID);
    expect(notify).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });
});

describe("notifyPromptComplete", () => {
  it.each([
    { stopReason: "tool_use", delivered: false },
    { stopReason: "max_tokens", delivered: false },
    { stopReason: "end_turn", delivered: true },
  ])(
    "stop reason '$stopReason' → delivered=$delivered",
    ({ stopReason, delivered }) => {
      const { bus, notify } = makeBus({ hasFocus: false });
      bus.notifyPromptComplete("My task", stopReason, TASK_ID);
      expect(notify).toHaveBeenCalledTimes(delivered ? 1 : 0);
    },
  );
});

describe("native tier settings gating (app unfocused)", () => {
  it("skips the OS notification when desktopNotifications is off, still dings dock", () => {
    const { bus, notify, showUnreadIndicator, requestAttention } = makeBus({
      hasFocus: false,
      settings: { desktopNotifications: false },
    });
    bus.notifyPermissionRequest("My task", TASK_ID);
    expect(notify).not.toHaveBeenCalled();
    expect(showUnreadIndicator).toHaveBeenCalledTimes(1);
    expect(requestAttention).toHaveBeenCalledTimes(1);
  });

  it("marks the OS notification silent when a custom sound plays", () => {
    const { bus, notify } = makeBus({
      hasFocus: false,
      settings: { completionSound: "meep" },
    });
    bus.notifyPermissionRequest("My task", TASK_ID);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true }),
    );
  });

  it("is not silent when completionSound is none", () => {
    const { bus, notify } = makeBus({
      hasFocus: false,
      settings: { completionSound: "none" },
    });
    bus.notifyPromptComplete("My task", "end_turn", TASK_ID);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ silent: false }),
    );
  });

  it("truncates long titles in the body", () => {
    const { bus, notify } = makeBus({ hasFocus: false });
    bus.notifyPromptComplete("x".repeat(80), "end_turn", TASK_ID);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: `"${"x".repeat(50)}..." finished` }),
    );
  });
});

describe("sound", () => {
  it("plays on the toast tier too (not just native)", () => {
    const { bus, play } = makeBus({
      hasFocus: true,
      activeTarget: taskTarget(OTHER_TASK_ID),
    });
    bus.notifyPromptComplete("My task", "end_turn", TASK_ID);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
