import { describe, expect, it } from "vitest";
import {
  RendererCrashRecovery,
  toSafeRendererUrl,
} from "./renderer-crash-recovery";

describe("RendererCrashRecovery", () => {
  it("escapes the crashing route before stopping automatic recovery", () => {
    const recovery = new RendererCrashRecovery({
      crashLoopThreshold: 3,
      crashLoopWindowMs: 30_000,
    });

    expect(recovery.nextAction(0)).toBe("reload");
    expect(recovery.nextAction(13_000)).toBe("reset-route");
    expect(recovery.nextAction(20_000)).toBe("stop");
  });

  it("starts with a normal reload after the crash window expires", () => {
    const recovery = new RendererCrashRecovery({
      crashLoopThreshold: 3,
      crashLoopWindowMs: 30_000,
    });

    expect(recovery.nextAction(0)).toBe("reload");
    expect(recovery.nextAction(31_000)).toBe("reload");
  });
});

describe("toSafeRendererUrl", () => {
  it("removes the route while preserving the renderer entrypoint", () => {
    expect(
      toSafeRendererUrl(
        "file:///Applications/PostHog%20Code.app/index.html#/website/site/tasks/task",
      ),
    ).toBe("file:///Applications/PostHog%20Code.app/index.html");
  });
});
