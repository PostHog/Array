import { assertHostCapabilities } from "@posthog/di/hostCapabilities";
import { REQUIRED_HOST_CAPABILITIES } from "@posthog/ui/shell/requiredHostCapabilities";
import { describe, expect, it } from "vitest";

// The web host is the portability smoke test: a single in-browser container, no
// Electron. This locks in that it binds every capability the shared app resolves
// via service location, so a gap like the missing inbox reportModelResolver
// fails in CI instead of at the first navigation that needs it.
describe("web composition root", () => {
  // Importing the composition root pulls the whole app module graph through
  // Vite's transform; on a cold CI runner that comfortably exceeds Vitest's
  // 5s default, so give it a generous ceiling (locally it's ~2-3s).
  it("binds every required host capability", { timeout: 30_000 }, async () => {
    // Importing the module builds the container and (as of the fix) already runs
    // assertHostCapabilities at the end; re-run it explicitly so a regression
    // fails here with the descriptive list rather than as a bare import error.
    const { container } = await import("./web-container");
    expect(() =>
      assertHostCapabilities(container, REQUIRED_HOST_CAPABILITIES),
    ).not.toThrow();
  });
});
