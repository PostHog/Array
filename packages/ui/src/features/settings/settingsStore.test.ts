import { registerRendererStateStorage } from "@posthog/ui/shell/rendererStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CompletionSound, useSettingsStore } from "./settingsStore";

const getItem = vi.fn();
const setItem = vi.fn();
const removeItem = vi.fn();

registerRendererStateStorage({ getItem, setItem, removeItem });

describe("feature settingsStore cloud selections", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    removeItem.mockReset();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    removeItem.mockResolvedValue(undefined);

    useSettingsStore.setState({
      allowBypassPermissions: false,
      lastUsedCloudRepository: null,
      cachedCloudRepositoryMap: {},
    });
  });

  it("persists the last used cloud repository", async () => {
    useSettingsStore.getState().setLastUsedCloudRepository("posthog/posthog");

    await vi.waitFor(() => {
      expect(setItem).toHaveBeenCalled();
    });

    const lastCall = setItem.mock.calls[setItem.mock.calls.length - 1];
    const persisted = JSON.parse(lastCall[1]);

    expect(persisted.state.lastUsedCloudRepository).toBe("posthog/posthog");
  });

  it("rehydrates the last used cloud repository", async () => {
    getItem.mockResolvedValue(
      JSON.stringify({
        state: {
          lastUsedCloudRepository: "posthog/posthog",
        },
        version: 0,
      }),
    );

    useSettingsStore.setState({
      lastUsedCloudRepository: null,
    });

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().lastUsedCloudRepository).toBe(
      "posthog/posthog",
    );
  });

  it("persists the cached cloud repository map", async () => {
    useSettingsStore.getState().setCachedCloudRepositoryMap({
      "posthog/posthog": {
        userIntegrationId: "user-1",
        installationId: "install-1",
      },
    });

    await vi.waitFor(() => {
      expect(setItem).toHaveBeenCalled();
    });

    const lastCall = setItem.mock.calls[setItem.mock.calls.length - 1];
    const persisted = JSON.parse(lastCall[1]);

    expect(persisted.state.cachedCloudRepositoryMap).toEqual({
      "posthog/posthog": {
        userIntegrationId: "user-1",
        installationId: "install-1",
      },
    });
  });

  it("rehydrates the cached cloud repository map", async () => {
    getItem.mockResolvedValue(
      JSON.stringify({
        state: {
          cachedCloudRepositoryMap: {
            "posthog/code": {
              userIntegrationId: "user-2",
              installationId: "install-2",
            },
          },
        },
        version: 0,
      }),
    );

    useSettingsStore.setState({ cachedCloudRepositoryMap: {} });

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().cachedCloudRepositoryMap).toEqual({
      "posthog/code": {
        userIntegrationId: "user-2",
        installationId: "install-2",
      },
    });
  });

  it("rehydrates the unsafe mode toggle", async () => {
    getItem.mockResolvedValue(
      JSON.stringify({
        state: {
          allowBypassPermissions: true,
        },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().allowBypassPermissions).toBe(true);
  });

  it.each([
    ["lastUsedWorkspaceMode", "local", "cloud"],
    ["debugLogsCloudRuns", false, true],
    ["slotMachineMode", false, true],
  ] as const)("rehydrates %s", async (field, initial, persisted) => {
    getItem.mockResolvedValue(
      JSON.stringify({ state: { [field]: persisted }, version: 0 }),
    );

    useSettingsStore.setState({ [field]: initial } as Parameters<
      typeof useSettingsStore.setState
    >[0]);

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()[field]).toBe(persisted);
  });

  it("flips _hasHydrated once the persisted snapshot lands", async () => {
    getItem.mockResolvedValue(JSON.stringify({ state: {}, version: 0 }));

    useSettingsStore.setState({ _hasHydrated: false });

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()._hasHydrated).toBe(true);
  });
});

describe("feature settingsStore custom sounds", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    removeItem.mockReset();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    removeItem.mockResolvedValue(undefined);

    useSettingsStore.setState({ customSounds: [], completionSound: "none" });
  });

  const sound = {
    id: "abc",
    name: "My ding",
    dataUrl: "data:audio/webm;base64,AAAA",
    durationMs: 1200,
  };

  it("adds a custom sound", () => {
    useSettingsStore.getState().addCustomSound(sound);
    expect(useSettingsStore.getState().customSounds).toEqual([sound]);
  });

  it("renames a custom sound without touching its clip", () => {
    useSettingsStore.getState().addCustomSound(sound);
    useSettingsStore.getState().renameCustomSound("abc", "Renamed");
    const stored = useSettingsStore.getState().customSounds[0];
    expect(stored.name).toBe("Renamed");
    expect(stored.dataUrl).toBe(sound.dataUrl);
  });

  it.each([
    {
      label: "active sound",
      activeSound: "custom:abc" as CompletionSound,
      expectedSound: "none" as CompletionSound,
    },
    {
      label: "non-active sound",
      activeSound: "meep" as CompletionSound,
      expectedSound: "meep" as CompletionSound,
    },
  ])(
    "removing the $label leaves completionSound as $expectedSound",
    ({ activeSound, expectedSound }) => {
      useSettingsStore.getState().addCustomSound(sound);
      useSettingsStore.getState().setCompletionSound(activeSound);
      useSettingsStore.getState().removeCustomSound("abc");
      expect(useSettingsStore.getState().customSounds).toEqual([]);
      expect(useSettingsStore.getState().completionSound).toBe(expectedSound);
    },
  );

  it("persists custom sounds", async () => {
    useSettingsStore.getState().addCustomSound(sound);

    await vi.waitFor(() => {
      expect(setItem).toHaveBeenCalled();
    });

    const lastCall = setItem.mock.calls[setItem.mock.calls.length - 1];
    const persisted = JSON.parse(lastCall[1]);
    expect(persisted.state.customSounds).toEqual([sound]);
  });
});

describe("feature settingsStore terminal font", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    removeItem.mockReset();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    removeItem.mockResolvedValue(undefined);

    useSettingsStore.setState({
      terminalFont: "berkeley-mono",
      terminalCustomFontFamily: "",
    });
  });

  it("defaults to berkeley-mono with no custom override", () => {
    expect(useSettingsStore.getState().terminalFont).toBe("berkeley-mono");
    expect(useSettingsStore.getState().terminalCustomFontFamily).toBe("");
  });

  it("persists terminal font selection and custom family", async () => {
    useSettingsStore.getState().setTerminalFont("custom");
    useSettingsStore.getState().setTerminalCustomFontFamily("Fira Code");

    await vi.waitFor(() => {
      expect(setItem).toHaveBeenCalled();
    });

    const lastCall = setItem.mock.calls[setItem.mock.calls.length - 1];
    const persisted = JSON.parse(lastCall[1]);

    expect(persisted.state.terminalFont).toBe("custom");
    expect(persisted.state.terminalCustomFontFamily).toBe("Fira Code");
  });

  it("rehydrates terminal font selection and custom family", async () => {
    getItem.mockResolvedValue(
      JSON.stringify({
        state: {
          terminalFont: "jetbrains-mono",
          terminalCustomFontFamily: "Cascadia Code",
        },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().terminalFont).toBe("jetbrains-mono");
    expect(useSettingsStore.getState().terminalCustomFontFamily).toBe(
      "Cascadia Code",
    );
  });
});
