import type { HostTrpcClient } from "@posthog/host-router/client";
import { registerRendererStateStorage } from "@posthog/ui/shell/rendererStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomInstructionsSyncContribution } from "./customInstructionsSync.contribution";
import { useSettingsStore } from "./settingsStore";

registerRendererStateStorage({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
});

const query = vi.fn();
const client = {
  os: { getUserAgentInstructions: { query } },
} as unknown as HostTrpcClient;

const staleFile = {
  path: "/home/u/.claude/CLAUDE.md",
  displayPath: "~/.claude/CLAUDE.md",
  content: "stale",
  truncated: false,
};
const freshFile = { ...staleFile, content: "fresh" };

/** Runs queued microtasks so a resolved read's continuation lands. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setSyncEnabled = (enabled: boolean) =>
  useSettingsStore.getState().setSyncCustomInstructionsFromFile(enabled);

describe("CustomInstructionsSyncContribution", () => {
  // The contribution subscribes to the module-level store and never
  // unsubscribes, so one shared instance serves every test.
  let started = false;

  beforeEach(() => {
    useSettingsStore.setState({
      _hasHydrated: true,
      syncCustomInstructionsFromFile: false,
      syncedCustomInstructions: null,
    });
    query.mockReset();
    if (!started) {
      new CustomInstructionsSyncContribution(client).start();
      started = true;
    }
  });

  it("mirrors the file into the store when sync turns on", async () => {
    query.mockResolvedValueOnce(freshFile);

    setSyncEnabled(true);
    await flush();

    expect(useSettingsStore.getState().syncedCustomInstructions).toEqual(
      freshFile,
    );
  });

  it("clears the snapshot when sync turns off", async () => {
    query.mockResolvedValueOnce(freshFile);
    setSyncEnabled(true);
    await flush();

    setSyncEnabled(false);

    expect(useSettingsStore.getState().syncedCustomInstructions).toBeNull();
  });

  it("discards a read that resolves after sync was toggled off", async () => {
    let resolveRead: (file: typeof staleFile) => void = () => {};
    query.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );

    setSyncEnabled(true);
    setSyncEnabled(false);
    resolveRead(staleFile);
    await flush();

    expect(useSettingsStore.getState().syncedCustomInstructions).toBeNull();
  });

  it("keeps the newest read when re-enable reads resolve out of order", async () => {
    let resolveFirst: (file: typeof staleFile) => void = () => {};
    let resolveSecond: (file: typeof freshFile) => void = () => {};
    query
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    setSyncEnabled(true);
    setSyncEnabled(false);
    setSyncEnabled(true);
    resolveSecond(freshFile);
    await flush();
    resolveFirst(staleFile);
    await flush();

    expect(useSettingsStore.getState().syncedCustomInstructions).toEqual(
      freshFile,
    );
  });
});
