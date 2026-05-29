import { beforeEach, describe, expect, it, vi } from "vitest";

const { getItem, setItem, removeItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@posthog/di/container", () => ({
  resolveService: () => ({ getItem, setItem, removeItem }),
}));

import { useSettingsStore } from "./settingsStore";

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
