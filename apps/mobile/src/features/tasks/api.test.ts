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
  getAccessToken: () => "token",
  createTimeoutSignal: () => undefined,
  authedFetch: (url: string, init?: RequestInit) =>
    mockFetch(url, {
      ...init,
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    }),
}));

import { runTaskInCloud } from "./api";

function bodyOf(call: unknown): Record<string, unknown> {
  const [, init] = call as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe("runTaskInCloud", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "task-1" }), { status: 200 }),
    );
  });

  it.each([true, false])(
    "forwards auto_publish=%s to the payload",
    async (flag) => {
      await runTaskInCloud("task-1", { autoPublish: flag });

      expect(bodyOf(mockFetch.mock.calls[0])).toMatchObject({
        auto_publish: flag,
      });
    },
  );

  it("omits auto_publish when not provided", async () => {
    await runTaskInCloud("task-1", { model: "claude-opus-4-8" });

    expect(bodyOf(mockFetch.mock.calls[0])).not.toHaveProperty("auto_publish");
  });

  it("sends no body for the plain initial run", async () => {
    await runTaskInCloud("task-1");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });

  it("sends rtk_enabled=false when the run opts out", async () => {
    await runTaskInCloud("task-1", { rtkEnabled: false });

    expect(bodyOf(mockFetch.mock.calls[0])).toMatchObject({
      rtk_enabled: false,
    });
  });

  it("omits rtk_enabled when the run keeps compression on", async () => {
    await runTaskInCloud("task-1", { rtkEnabled: true });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });
});
