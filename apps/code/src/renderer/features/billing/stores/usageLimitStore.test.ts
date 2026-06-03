import { beforeEach, describe, expect, it } from "vitest";
import { useUsageLimitStore } from "./usageLimitStore";

describe("usageLimitStore", () => {
  beforeEach(() => {
    useUsageLimitStore.setState({
      isOpen: false,
      bucket: null,
      resetAt: null,
    });
  });

  it("starts closed", () => {
    const state = useUsageLimitStore.getState();
    expect(state.isOpen).toBe(false);
  });

  it("show opens the modal with no context", () => {
    useUsageLimitStore.getState().show();
    const state = useUsageLimitStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.bucket).toBeNull();
    expect(state.resetAt).toBeNull();
  });

  it("show stores bucket and resetAt when provided", () => {
    useUsageLimitStore.getState().show({
      bucket: "burst",
      resetAt: "2026-01-02T03:04:05Z",
    });
    const state = useUsageLimitStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.bucket).toBe("burst");
    expect(state.resetAt).toBe("2026-01-02T03:04:05Z");
  });

  it("hide closes the modal", () => {
    useUsageLimitStore.getState().show();
    useUsageLimitStore.getState().hide();
    expect(useUsageLimitStore.getState().isOpen).toBe(false);
  });
});
