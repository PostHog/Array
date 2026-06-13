import { beforeEach, describe, expect, it } from "vitest";
import { useRemoteBranchConfirmStore } from "./remoteBranchConfirmStore";

describe("remoteBranchConfirmStore", () => {
  beforeEach(() => {
    useRemoteBranchConfirmStore.setState({
      isOpen: false,
      branch: null,
      resolve: null,
    });
  });

  it("starts closed", () => {
    const state = useRemoteBranchConfirmStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.branch).toBeNull();
  });

  it("confirm opens the dialog with the branch", () => {
    void useRemoteBranchConfirmStore.getState().confirm("feature/x");
    const state = useRemoteBranchConfirmStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.branch).toBe("feature/x");
  });

  it("accept resolves the pending promise with true and closes", async () => {
    const promise = useRemoteBranchConfirmStore.getState().confirm("feature/x");
    useRemoteBranchConfirmStore.getState().accept();
    await expect(promise).resolves.toBe(true);
    const state = useRemoteBranchConfirmStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.branch).toBeNull();
    expect(state.resolve).toBeNull();
  });

  it("cancel resolves the pending promise with false and closes", async () => {
    const promise = useRemoteBranchConfirmStore.getState().confirm("feature/x");
    useRemoteBranchConfirmStore.getState().cancel();
    await expect(promise).resolves.toBe(false);
    expect(useRemoteBranchConfirmStore.getState().isOpen).toBe(false);
  });

  it("opening a second dialog resolves the first as cancelled", async () => {
    const first = useRemoteBranchConfirmStore.getState().confirm("first");
    const second = useRemoteBranchConfirmStore.getState().confirm("second");
    await expect(first).resolves.toBe(false);
    expect(useRemoteBranchConfirmStore.getState().branch).toBe("second");
    useRemoteBranchConfirmStore.getState().accept();
    await expect(second).resolves.toBe(true);
  });
});
