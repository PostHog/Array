import type { CanvasCapabilities } from "@posthog/shared/canvas-application";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { handleFreeformDataRequest } from "./freeformDataBridge";

vi.mock("../hostClient", () => ({
  hostClient: () => ({
    canvasData: {
      query: {
        mutate: vi.fn().mockResolvedValue({ columns: [], results: [] }),
      },
      loadInsight: {
        mutate: vi.fn().mockResolvedValue({ columns: [], results: [] }),
      },
      capture: { mutate: vi.fn().mockResolvedValue({ ok: true }) },
    },
  }),
}));

const capabilities: CanvasCapabilities = {
  posthog: {
    insights: ["allowed"],
    inlineQueries: false,
    captureEvents: ["allowed event"],
  },
  network: { origins: [] },
};

describe("handleFreeformDataRequest capabilities", () => {
  it.each([
    ["loadInsight", { shortId: "blocked" }, "not declared"],
    ["query", { hogql: "select 1" }, "not allowed"],
    ["capture", { event: "blocked event" }, "not declared"],
  ])("rejects undeclared %s calls", async (method, payload, message) => {
    await expect(
      handleFreeformDataRequest(
        method,
        payload,
        new QueryClient(),
        capabilities,
      ),
    ).rejects.toThrow(message);
  });

  it.each([
    ["loadInsight", { shortId: "allowed" }],
    ["capture", { event: "allowed event" }],
  ])("allows declared %s calls", async (method, payload) => {
    await expect(
      handleFreeformDataRequest(
        method,
        payload,
        new QueryClient(),
        capabilities,
      ),
    ).resolves.toBeDefined();
  });

  it("keeps the legacy author bridge permissive when no manifest exists", async () => {
    await expect(
      handleFreeformDataRequest(
        "query",
        { hogql: "select 1" },
        new QueryClient(),
      ),
    ).resolves.toBeDefined();
  });
});
