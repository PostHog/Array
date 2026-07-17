import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("browserViewService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("defaults to %s in development mode", async (isDev, expected) => {
    vi.stubEnv("POSTHOG_CODE_IS_DEV", isDev);
    const { browserViewService } = await import("./service");

    expect(browserViewService.isEnabled()).toBe(expected);
  });

  it("updates the attachment gate", async () => {
    vi.stubEnv("POSTHOG_CODE_IS_DEV", "false");
    const { browserViewService } = await import("./service");

    browserViewService.setEnabled(true);

    expect(browserViewService.isEnabled()).toBe(true);
  });
});
