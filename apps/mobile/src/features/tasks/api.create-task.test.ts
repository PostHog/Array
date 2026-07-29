import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("expo/fetch", () => ({
  fetch: mockFetch,
}));

vi.mock("@/lib/api", () => ({
  getBaseUrl: () => "https://app.posthog.test",
  getProjectId: () => 42,
  authedFetch: (url: string, init?: RequestInit) => mockFetch(url, init),
}));

import { createTask } from "./api";

describe("createTask", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "task-1" }), { status: 200 }),
    );
  });

  it("routes signal report tasks through the dedicated endpoint", async () => {
    await createTask({
      description: "Implement report",
      origin_product: "signal_report",
      signal_report: "report-123",
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://app.posthog.test/api/projects/42/tasks/from_signal_report/",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      description: "Implement report",
      signal_report: "report-123",
    });
  });
});
