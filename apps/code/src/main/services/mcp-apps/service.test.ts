import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { McpAppsService } from "./service";

function makeService(): McpAppsService {
  const urlLauncher = { launch: vi.fn() };
  return new McpAppsService(urlLauncher as never);
}

describe("McpAppsService.getUiResourceByUri", () => {
  let service: McpAppsService;

  beforeEach(() => {
    service = makeService();
  });

  it("rejects non-ui:// URIs without attempting a fetch", async () => {
    await expect(
      service.getUiResourceByUri("posthog", "https://evil.example/app.html"),
    ).resolves.toBeNull();
    await expect(
      service.getUiResourceByUri("posthog", "file:///etc/passwd"),
    ).resolves.toBeNull();
  });

  it("rejects when the server has no connection config", async () => {
    // ui:// passes the guard, but with no configured server the lazy connection
    // fails. The fetch rethrows rather than caching a permanent null, so the
    // caller's query can surface the error and retry once boot populates configs.
    await expect(
      service.getUiResourceByUri("posthog", "ui://posthog/survey-list.html"),
    ).rejects.toThrow("No server config for: posthog");
  });
});
