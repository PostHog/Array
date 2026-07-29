import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadNavigationStore } from "./threadNavigationStore";
import { useThreadScrollRequest } from "./useThreadScrollRequest";

beforeEach(() => {
  useThreadNavigationStore.setState({ scrollRequests: {} });
});

describe("useThreadScrollRequest", () => {
  it("serves a request from another pane and consumes it", () => {
    const jump = vi.fn();
    renderHook(() => useThreadScrollRequest("task-1", jump));

    act(() => {
      useThreadNavigationStore
        .getState()
        .requestScrollToMessage("task-1", "turn-10-1-user");
    });

    expect(jump).toHaveBeenCalledWith("turn-10-1-user");
    // Cleared, so re-rendering for any other reason can't re-fire the jump and
    // yank the transcript back.
    expect(useThreadNavigationStore.getState().scrollRequests["task-1"]).toBe(
      null,
    );
  });

  it("ignores requests aimed at a different task", () => {
    const jump = vi.fn();
    renderHook(() => useThreadScrollRequest("task-1", jump));

    act(() => {
      useThreadNavigationStore
        .getState()
        .requestScrollToMessage("task-2", "turn-10-1-user");
    });

    expect(jump).not.toHaveBeenCalled();
    expect(useThreadNavigationStore.getState().scrollRequests["task-2"]).toBe(
      "turn-10-1-user",
    );
  });

  it("does nothing without a task id", () => {
    const jump = vi.fn();
    renderHook(() => useThreadScrollRequest(undefined, jump));

    act(() => {
      useThreadNavigationStore
        .getState()
        .requestScrollToMessage("task-1", "turn-10-1-user");
    });

    expect(jump).not.toHaveBeenCalled();
  });

  it("re-fires when the same message is requested again", () => {
    const jump = vi.fn();
    renderHook(() => useThreadScrollRequest("task-1", jump));
    const request = () =>
      act(() => {
        useThreadNavigationStore
          .getState()
          .requestScrollToMessage("task-1", "turn-10-1-user");
      });

    request();
    request();

    expect(jump).toHaveBeenCalledTimes(2);
  });
});
