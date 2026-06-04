import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendMutate,
  showDockBadgeMutate,
  bounceDockMutate,
  playSound,
  getViewSnapshot,
} = vi.hoisted(() => ({
  sendMutate: vi.fn().mockResolvedValue(undefined),
  showDockBadgeMutate: vi.fn().mockResolvedValue(undefined),
  bounceDockMutate: vi.fn().mockResolvedValue(undefined),
  playSound: vi.fn(),
  getViewSnapshot: vi.fn(
    () =>
      ({ type: "task-input" }) as {
        type: string;
        taskId?: string;
      },
  ),
}));

vi.mock("@hooks/useAppView", () => ({
  getAppViewSnapshot: getViewSnapshot,
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    notification: {
      send: { mutate: sendMutate },
      showDockBadge: { mutate: showDockBadgeMutate },
      bounceDock: { mutate: bounceDockMutate },
    },
    secureStore: {
      getItem: { query: vi.fn().mockResolvedValue(null) },
      setItem: { query: vi.fn().mockResolvedValue(undefined) },
      removeItem: { query: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@utils/logger", () => ({
  logger: { scope: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("@utils/analytics", () => ({ track: vi.fn() }));

vi.mock("@utils/sounds", () => ({
  playCompletionSound: playSound,
}));

import { notifyPermissionRequest, notifyPromptComplete } from "./notifications";

const TASK_ID = "task-123";
const OTHER_TASK_ID = "task-999";

type View = { type: string; data?: { id: string }; taskId?: string };

function setView(view: View) {
  // The notifications module now reads via getAppViewSnapshot which returns
  // the view shape directly (no nesting under `view`).
  getViewSnapshot.mockReturnValue({
    type: view.type,
    taskId: view.taskId ?? view.data?.id,
  });
}

function setFocus(focused: boolean) {
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
}

describe("notifications", () => {
  beforeEach(() => {
    sendMutate.mockClear();
    showDockBadgeMutate.mockClear();
    bounceDockMutate.mockClear();
    playSound.mockClear();
    useSettingsStore.setState({
      desktopNotifications: true,
      dockBadgeNotifications: true,
      dockBounceNotifications: true,
      completionSound: "meep",
      completionVolume: 80,
    });
    setView({ type: "task-input" });
  });

  describe("shouldNotifyForTask gating (via notifyPermissionRequest)", () => {
    const cases: ReadonlyArray<{
      name: string;
      focused: boolean;
      view: View;
      taskId?: string;
      shouldNotify: boolean;
    }> = [
      {
        name: "window unfocused → notifies",
        focused: false,
        view: { type: "task-detail", data: { id: TASK_ID }, taskId: TASK_ID },
        taskId: TASK_ID,
        shouldNotify: true,
      },
      {
        name: "focused on the same task → does not notify",
        focused: true,
        view: { type: "task-detail", data: { id: TASK_ID }, taskId: TASK_ID },
        taskId: TASK_ID,
        shouldNotify: false,
      },
      {
        name: "focused on a different task → notifies",
        focused: true,
        view: {
          type: "task-detail",
          data: { id: OTHER_TASK_ID },
          taskId: OTHER_TASK_ID,
        },
        taskId: TASK_ID,
        shouldNotify: true,
      },
      {
        name: "focused but view is not task-detail → notifies",
        focused: true,
        view: { type: "inbox" },
        taskId: TASK_ID,
        shouldNotify: true,
      },
      {
        name: "focused with no taskId supplied → does not notify",
        focused: true,
        view: { type: "inbox" },
        taskId: undefined,
        shouldNotify: false,
      },
      {
        name: "focused, view.data missing, falls back to view.taskId → does not notify",
        focused: true,
        view: { type: "task-detail", taskId: TASK_ID },
        taskId: TASK_ID,
        shouldNotify: false,
      },
    ];

    it.each(cases)("$name", ({ focused, view, taskId, shouldNotify }) => {
      setFocus(focused);
      setView(view);

      notifyPermissionRequest("My task", taskId);

      expect(sendMutate).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
      expect(playSound).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
    });
  });

  describe("notifyPromptComplete", () => {
    it.each([
      { stopReason: "tool_use", shouldNotify: false },
      { stopReason: "max_tokens", shouldNotify: false },
      { stopReason: "end_turn", shouldNotify: true },
    ])(
      "stop reason '$stopReason' → notifies=$shouldNotify",
      ({ stopReason, shouldNotify }) => {
        setFocus(false);
        notifyPromptComplete("My task", stopReason, TASK_ID);
        expect(sendMutate).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
      },
    );

    it.each([
      {
        name: "focused on same task → does not notify",
        view: { type: "task-detail", data: { id: TASK_ID }, taskId: TASK_ID },
        shouldNotify: false,
      },
      {
        name: "focused on different task → notifies",
        view: {
          type: "task-detail",
          data: { id: OTHER_TASK_ID },
          taskId: OTHER_TASK_ID,
        },
        shouldNotify: true,
      },
    ])("$name", ({ view, shouldNotify }) => {
      setFocus(true);
      setView(view);
      notifyPromptComplete("My task", "end_turn", TASK_ID);
      expect(sendMutate).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
    });
  });
});
