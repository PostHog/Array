import type {
  SettingsBackupSettingsStore,
  SettingsBackupState,
  SettingsBackupTheme,
  SettingsBackupThemeStore,
} from "@posthog/core/settings/settingsBackup";
import { SettingsBackupService } from "@posthog/core/settings/settingsBackupService";
import { beforeEach, describe, expect, it } from "vitest";

function createState(): SettingsBackupState {
  return {
    desktopNotifications: true,
    dockBadgeNotifications: true,
    dockBounceNotifications: false,
    toastNotifications: true,
    completionSound: "none",
    completionVolume: 80,
    scaleSoundWithTaskLength: false,
    defaultRunMode: "local",
    defaultInitialTaskMode: "plan",
    defaultReasoningEffort: "high",
    defaultMessagingMode: "queue",
    autoConvertLongText: "2500",
    sendMessagesWith: "enter",
    customInstructions: "Be concise",
    diffOpenMode: "auto",
    conversationCollapseMode: "expanded",
    terminalFont: "system",
    terminalCustomFontFamily: "",
    terminalGpuRendering: true,
    debugLogsCloudRuns: false,
    autoPublishCloudRuns: false,
    downloadUpdatesAutomatically: true,
    hedgehogMode: false,
    slotMachineMode: false,
    brainrotMode: false,
    mcpAppsDisabledServers: [],
    dismissibleUpdateBanners: true,
    useNewChatThread: true,
    lastSeenChangelogVersion: null,
    hints: {},
    lastUsedCloudRepository: "posthog/private-repo",
    lastUsedEnvironments: { "/private/repo": "env-1" },
    preventSleepWhileRunning: true,
    allowBypassPermissions: true,
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
  };
}

describe("SettingsBackupService", () => {
  let state: SettingsBackupState;
  let theme: SettingsBackupTheme;
  let service: SettingsBackupService;

  beforeEach(() => {
    state = createState();
    theme = "system";
    const settingsStore: SettingsBackupSettingsStore = {
      getState: () => state,
      setState: (patch) => Object.assign(state, patch),
    };
    const themeStore: SettingsBackupThemeStore = {
      getTheme: () => theme,
      setTheme: (nextTheme) => {
        theme = nextTheme;
      },
    };
    service = new SettingsBackupService(settingsStore, themeStore);
  });

  it("excludes machine-local and unsafe settings", () => {
    const backup = service.inspectArchive(service.exportArchive());
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
    const backup = service.inspectArchive(service.exportArchive());
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

    service.applyBackup(backup, new Set(["notifications"]));

    expect(state.completionVolume).toBe(25);
    expect(state.customSounds).toEqual([
      expect.objectContaining({ id: "local-only" }),
      expect.objectContaining({ id: "ding", name: "Imported ding" }),
    ]);
    expect(state.customInstructions).toBe("Be concise");
  });

  it("coordinates appearance imports with the theme store", () => {
    const backup = service.inspectArchive(service.exportArchive());
    const appearance = backup.manifest.categories.appearance;
    if (!appearance) throw new Error("Expected appearance in backup");
    backup.manifest.categories.appearance = {
      ...appearance,
      theme: "dark",
    };

    service.applyBackup(backup, new Set(["appearance"]));

    expect(theme).toBe("dark");
  });
});
