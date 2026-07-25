import { describe, expect, it } from "vitest";
import { createSettingsBackup, parseSettingsBackup } from "./settingsBackup";

describe("settings backup", () => {
  it("round trips categories and custom sounds", () => {
    const bytes = createSettingsBackup(
      {
        notifications: {
          desktopNotifications: true,
          dockBadgeNotifications: true,
          dockBounceNotifications: false,
          toastNotifications: true,
          completionSound: "none",
          completionVolume: 42,
          scaleSoundWithTaskLength: false,
        },
      },
      [
        {
          id: "ding",
          name: "Ding",
          durationMs: 500,
          dataUrl: "data:audio/webm;base64,AAEC",
        },
      ],
      "2026-07-25T00:00:00.000Z",
    );
    const backup = parseSettingsBackup(bytes);
    expect(backup.manifest.categories.notifications?.completionVolume).toBe(42);
    expect(backup.manifest.sounds[0]).toMatchObject({
      id: "ding",
      name: "Ding",
    });
    expect(backup.soundDataUrls.ding).toBe("data:audio/webm;base64,AAEC");
  });

  it("rejects data that is not an archive", () => {
    expect(() => parseSettingsBackup(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
