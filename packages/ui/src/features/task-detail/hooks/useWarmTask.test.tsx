import type { WorkspaceMode } from "@posthog/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  warmTask: vi.fn(),
}));
const flagState = vi.hoisted(() => ({ enabled: true }));

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));
vi.mock("@posthog/ui/features/feature-flags/useFeatureFlag", () => ({
  useFeatureFlag: () => flagState.enabled,
}));
vi.mock("../../../shell/logger", () => ({
  logger: { scope: () => ({ warn: vi.fn(), error: vi.fn() }) },
}));

import { useWarmTask } from "./useWarmTask";

interface Props {
  workspaceMode: WorkspaceMode;
  selectedRepository?: string | null;
  githubIntegrationId?: number;
  branch?: string | null;
  editorIsEmpty: boolean;
  runtimeAdapter?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}

const cloudTyping: Props = {
  workspaceMode: "cloud",
  selectedRepository: "acme/repo",
  githubIntegrationId: 42,
  branch: "main",
  editorIsEmpty: false,
};

const NULL_RUNTIME = {
  runtime_adapter: null,
  model: null,
  reasoning_effort: null,
};

describe("useWarmTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    flagState.enabled = true;
    mockClient.warmTask.mockResolvedValue({
      task_id: "task-1",
      run_id: "run-1",
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function flushDebounce(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  }

  it("fires a debounced warm when cloud + repo + typing", async () => {
    renderHook((props: Props) => useWarmTask(props), {
      initialProps: cloudTyping,
    });

    expect(mockClient.warmTask).not.toHaveBeenCalled();

    await flushDebounce();

    expect(mockClient.warmTask).toHaveBeenCalledWith({
      repository: "acme/repo",
      github_integration: 42,
      branch: "main",
      ...NULL_RUNTIME,
    });
  });

  it.each<{ name: string; props?: Partial<Props>; flagEnabled?: boolean }>([
    { name: "the flag is off", flagEnabled: false },
    { name: "not in cloud mode", props: { workspaceMode: "local" } },
    { name: "no repository is selected", props: { selectedRepository: null } },
    {
      name: "no github integration",
      props: { githubIntegrationId: undefined },
    },
    { name: "the editor is empty", props: { editorIsEmpty: true } },
  ])("does not fire when $name", async ({ props, flagEnabled }) => {
    if (flagEnabled === false) {
      flagState.enabled = false;
    }
    renderHook((p: Props) => useWarmTask(p), {
      initialProps: { ...cloudTyping, ...props },
    });
    await flushDebounce();
    expect(mockClient.warmTask).not.toHaveBeenCalled();
  });

  it("fires once the editor becomes non-empty", async () => {
    const { rerender } = renderHook((props: Props) => useWarmTask(props), {
      initialProps: { ...cloudTyping, editorIsEmpty: true },
    });
    await flushDebounce();
    expect(mockClient.warmTask).not.toHaveBeenCalled();

    rerender(cloudTyping);
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenCalledOnce();
  });

  it("does not re-fire for the same selection (backend dedups, client guards)", async () => {
    const { rerender } = renderHook((props: Props) => useWarmTask(props), {
      initialProps: cloudTyping,
    });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenCalledOnce();

    rerender({ ...cloudTyping });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenCalledOnce();
  });

  it("warms the new selection when the repository changes (no release)", async () => {
    const { rerender } = renderHook((props: Props) => useWarmTask(props), {
      initialProps: cloudTyping,
    });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenCalledOnce();

    rerender({ ...cloudTyping, selectedRepository: "acme/other" });
    await flushDebounce();

    expect(mockClient.warmTask).toHaveBeenLastCalledWith({
      repository: "acme/other",
      github_integration: 42,
      branch: "main",
      ...NULL_RUNTIME,
    });
    expect(mockClient.warmTask).toHaveBeenCalledTimes(2);
  });

  it("warms the new selection when the branch changes (no release)", async () => {
    const { rerender } = renderHook((props: Props) => useWarmTask(props), {
      initialProps: cloudTyping,
    });
    await flushDebounce();

    rerender({ ...cloudTyping, branch: "feature/x" });
    await flushDebounce();

    expect(mockClient.warmTask).toHaveBeenLastCalledWith({
      repository: "acme/repo",
      github_integration: 42,
      branch: "feature/x",
      ...NULL_RUNTIME,
    });
    expect(mockClient.warmTask).toHaveBeenCalledTimes(2);
  });

  it("forwards the selected runtime and re-warms when it changes", async () => {
    const { rerender } = renderHook((props: Props) => useWarmTask(props), {
      initialProps: {
        ...cloudTyping,
        runtimeAdapter: "claude",
        model: "claude-opus-4-8",
        reasoningEffort: "high",
      },
    });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenLastCalledWith({
      repository: "acme/repo",
      github_integration: 42,
      branch: "main",
      runtime_adapter: "claude",
      model: "claude-opus-4-8",
      reasoning_effort: "high",
    });

    rerender({
      ...cloudTyping,
      runtimeAdapter: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenLastCalledWith({
      repository: "acme/repo",
      github_integration: 42,
      branch: "main",
      runtime_adapter: "codex",
      model: "gpt-5.5",
      reasoning_effort: "high",
    });
    expect(mockClient.warmTask).toHaveBeenCalledTimes(2);
  });

  it("warms again for a new selection after a failed warm", async () => {
    mockClient.warmTask.mockRejectedValueOnce(new Error("boom"));
    const { rerender } = renderHook((props: Props) => useWarmTask(props), {
      initialProps: cloudTyping,
    });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenCalledOnce();

    rerender({ ...cloudTyping, branch: "feature/x" });
    await flushDebounce();
    expect(mockClient.warmTask).toHaveBeenCalledTimes(2);
  });

  it("swallows warm errors without throwing", async () => {
    mockClient.warmTask.mockRejectedValue(new Error("boom"));
    renderHook((props: Props) => useWarmTask(props), {
      initialProps: cloudTyping,
    });

    await expect(flushDebounce()).resolves.not.toThrow();
    expect(mockClient.warmTask).toHaveBeenCalledOnce();
  });
});
