import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useNavigationStore } from "@stores/navigationStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMutate, showDockBadgeMutate, bounceDockMutate, playSound } =
  vi.hoisted(() => ({
    sendMutate: vi.fn().mockResolvedValue(undefined),
    showDockBadgeMutate: vi.fn().mockResolvedValue(undefined),
    bounceDockMutate: vi.fn().mockResolvedValue(undefined),
    playSound: vi.fn(),
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

function setView(view: {
  type: string;
  data?: { id: string };
  taskId?: string;
}) {
  useNavigationStore.setState({
    // biome-ignore lint/suspicious/noExplicitAny: test-only narrow cast
    view: view as any,
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
    it("notifies when the window is unfocused", () => {
      setFocus(false);
      setView({ type: "task-detail", data: { id: TASK_ID }, taskId: TASK_ID });

      notifyPermissionRequest("My task", TASK_ID);

      expect(sendMutate).toHaveBeenCalledTimes(1);
      expect(playSound).toHaveBeenCalledTimes(1);
    });

    it("does NOT notify when focused on the same task", () => {
      setFocus(true);
      setView({ type: "task-detail", data: { id: TASK_ID }, taskId: TASK_ID });

      notifyPermissionRequest("My task", TASK_ID);

      expect(sendMutate).not.toHaveBeenCalled();
      expect(playSound).not.toHaveBeenCalled();
    });

    it("notifies when focused but viewing a different task", () => {
      setFocus(true);
      setView({
        type: "task-detail",
        data: { id: OTHER_TASK_ID },
        taskId: OTHER_TASK_ID,
      });

      notifyPermissionRequest("My task", TASK_ID);

      expect(sendMutate).toHaveBeenCalledTimes(1);
      expect(playSound).toHaveBeenCalledTimes(1);
    });

    it("notifies when focused but the view is not a task-detail", () => {
      setFocus(true);
      setView({ type: "inbox" });

      notifyPermissionRequest("My task", TASK_ID);

      expect(sendMutate).toHaveBeenCalledTimes(1);
    });

    it("does NOT notify when focused and no taskId is supplied", () => {
      setFocus(true);
      setView({ type: "inbox" });

      notifyPermissionRequest("My task");

      expect(sendMutate).not.toHaveBeenCalled();
    });

    it("falls back to view.taskId when view.data is missing", () => {
      setFocus(true);
      setView({ type: "task-detail", taskId: TASK_ID });

      notifyPermissionRequest("My task", TASK_ID);

      expect(sendMutate).not.toHaveBeenCalled();
    });
  });

  describe("notifyPromptComplete", () => {
    it("only fires on end_turn", () => {
      setFocus(false);
      notifyPromptComplete("My task", "tool_use", TASK_ID);
      expect(sendMutate).not.toHaveBeenCalled();

      notifyPromptComplete("My task", "end_turn", TASK_ID);
      expect(sendMutate).toHaveBeenCalledTimes(1);
    });

    it("applies the same task-aware gating", () => {
      setFocus(true);
      setView({ type: "task-detail", data: { id: TASK_ID }, taskId: TASK_ID });
      notifyPromptComplete("My task", "end_turn", TASK_ID);
      expect(sendMutate).not.toHaveBeenCalled();

      setView({
        type: "task-detail",
        data: { id: OTHER_TASK_ID },
        taskId: OTHER_TASK_ID,
      });
      notifyPromptComplete("My task", "end_turn", TASK_ID);
      expect(sendMutate).toHaveBeenCalledTimes(1);
    });
  });
});
