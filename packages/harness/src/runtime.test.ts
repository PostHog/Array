import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessRuntime } from "./runtime";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "posthog-harness-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("createHarnessRuntime", () => {
  it("returns a native Pi runtime with the PostHog model and named harness extensions", async () => {
    vi.stubEnv("PI_OFFLINE", "1");
    const pi = await import("@earendil-works/pi-coding-agent");
    const cwd = await temporaryDirectory();
    const agentDir = await temporaryDirectory();

    const runtime = await createHarnessRuntime({
      agentDir,
      authStorage: pi.AuthStorage.inMemory(),
      cwd,
      sessionManager: pi.SessionManager.inMemory(cwd),
    });

    try {
      expect(runtime).toBeInstanceOf(pi.AgentSessionRuntime);
      expect(runtime.session.model?.provider).toBe("posthog");
      expect(runtime.services.settingsManager.isProjectTrusted()).toBe(false);
      expect(
        runtime.services.resourceLoader
          .getExtensions()
          .extensions.map((extension) => extension.path),
      ).toEqual(
        expect.arrayContaining([
          "<inline:hog-branding>",
          "<inline:posthog-provider>",
          "<inline:web-access>",
          "<inline:subagent>",
          "<inline:workflow>",
          "<inline:mcp>",
        ]),
      );
    } finally {
      await runtime.dispose();
    }
  });
});
