import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSignalReportTask = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: "created" }),
);
const getUserIntegrationIdForRepo = vi.hoisted(() => vi.fn(() => "ghu_1"));
const openTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@posthog/ui/features/auth/store", () => ({
  useAuthStateValue: (sel: (s: { cloudRegion: string }) => unknown) =>
    sel({ cloudRegion: "us" }),
}));
vi.mock("@posthog/ui/features/integrations/useIntegrations", () => ({
  useUserRepositoryIntegration: () => ({ getUserIntegrationIdForRepo }),
}));
vi.mock("@posthog/ui/features/settings/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      lastUsedAdapter: "claude",
      lastUsedModel: "claude-sonnet",
      lastUsedReasoningEffort: undefined,
    }),
  },
}));
vi.mock("@posthog/di/react", () => ({
  useService: () => ({ createSignalReportTask }),
}));
vi.mock("@posthog/ui/features/tasks/useTaskCrudMutations", () => ({
  useCreateTask: () => ({ invalidateTasks: vi.fn() }),
}));
vi.mock("@posthog/ui/router/useOpenTask", () => ({
  openTask,
}));
vi.mock("@posthog/ui/shell/analytics", () => ({ track: vi.fn() }));
vi.mock("@posthog/ui/shell/logger", () => ({
  logger: { scope: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn(), loading: vi.fn(() => "toast-1") },
}));
vi.mock("sonner", () => ({ toast: { dismiss: vi.fn() } }));

import { useDiscussReport } from "./useDiscussReport";

describe("useDiscussReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserIntegrationIdForRepo.mockReturnValue("ghu_1");
    createSignalReportTask.mockResolvedValue({ status: "created" });
  });

  it("forwards a null repository to the service for gating", async () => {
    createSignalReportTask.mockResolvedValue({ status: "missing-repository" });
    const { result } = renderHook(() =>
      useDiscussReport({
        reportId: "r1",
        reportTitle: "T",
        cloudRepository: null,
      }),
    );
    await result.current.discussReport("why?");
    expect(createSignalReportTask).toHaveBeenCalledTimes(1);
    expect(createSignalReportTask.mock.calls[0][0].cloudRepository).toBeNull();
  });

  it("creates a cloud signal_report task through the service when valid", async () => {
    const { result } = renderHook(() =>
      useDiscussReport({
        reportId: "r1",
        reportTitle: "T",
        cloudRepository: "owner/repo",
      }),
    );
    await result.current.discussReport("why?");
    expect(createSignalReportTask).toHaveBeenCalledTimes(1);
    const input = createSignalReportTask.mock.calls[0][0];
    expect(input.kind).toBe("discuss");
    expect(input.reportId).toBe("r1");
    expect(input.cloudRepository).toBe("owner/repo");
    expect(input.githubUserIntegrationId).toBe("ghu_1");
  });
});
