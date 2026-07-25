import { registerRendererStateStorage } from "@posthog/ui/shell/rendererStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySettingsBackup,
  exportSettingsArchive,
  inspectSettingsArchive,
} from "./settingsBackup";
import { useSettingsStore } from "./settingsStore";

registerRendererStateStorage({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
});

describe("portable settings backup", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      completionVolume: 80,
      customInstructions: "Be concise",
      lastUsedCloudRepository: "posthog/private-repo",
      lastUsedEnvironments: { "/private/repo": "env-1" },
      customSounds: [
        {
          id: "ding",
          name: "Old ding",
          durationMs: 500,
          dataUrl: "data:audio/webm;base64,AAEC",
        },
        {
          id: "local-only",
          name: "Local only",
          durationMs: 200,
          dataUrl: "data:audio/webm;base64,AwQ=",
        },
      ],
    });
  });

  it("excludes machine-local repository history", () => {
    const backup = inspectSettingsArchive(exportSettingsArchive());
    const serialized = JSON.stringify(backup.manifest);
    expect(serialized).not.toContain("private-repo");
    expect(serialized).not.toContain("/private/repo");
    expect(serialized).not.toContain("preventSleepWhileRunning");
    expect(serialized).not.toContain("allowBypassPermissions");
    expect(backup.manifest.categories.composer?.customInstructions).toBe(
      "Be concise",
    );
  });

  it("applies selected categories and merges sounds by id", () => {
    const backup = inspectSettingsArchive(exportSettingsArchive());
    const notifications = backup.manifest.categories.notifications;
    if (!notifications) throw new Error("Expected notifications in backup");
    backup.manifest.categories.notifications = {
      ...notifications,
      completionVolume: 25,
    };
    backup.manifest.sounds[0].name = "Imported ding";
    backup.manifest.sounds = backup.manifest.sounds.filter(
      ({ id }) => id !== "local-only",
    );

    applySettingsBackup(backup, new Set(["notifications"]));

    expect(useSettingsStore.getState().completionVolume).toBe(25);
    expect(useSettingsStore.getState().customSounds).toEqual([
      expect.objectContaining({ id: "local-only" }),
      expect.objectContaining({ id: "ding", name: "Imported ding" }),
    ]);
    expect(useSettingsStore.getState().customInstructions).toBe("Be concise");
  });
});
