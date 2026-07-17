import { describe, expect, it } from "vitest";
import {
  getAddableTabKinds,
  isPanelTabAvailable,
  type TabAvailability,
} from "./tabAvailability";

describe("tab availability", () => {
  it.each<[string, TabAvailability, string[], boolean, boolean]>([
    [
      "desktop local",
      { browserEnabled: true, terminalEnabled: true },
      ["terminal", "browser"],
      true,
      true,
    ],
    [
      "desktop cloud",
      { browserEnabled: true, terminalEnabled: false },
      ["browser"],
      false,
      true,
    ],
    [
      "web",
      { browserEnabled: false, terminalEnabled: false },
      [],
      false,
      false,
    ],
    [
      "browser flag disabled",
      { browserEnabled: false, terminalEnabled: true },
      ["terminal"],
      true,
      false,
    ],
  ])(
    "%s exposes only supported tab kinds",
    (_name, availability, addableKinds, terminalVisible, browserVisible) => {
      expect(getAddableTabKinds(availability)).toEqual(addableKinds);
      expect(isPanelTabAvailable("terminal", availability)).toBe(
        terminalVisible,
      );
      expect(isPanelTabAvailable("browser", availability)).toBe(browserVisible);
      expect(isPanelTabAvailable("logs", availability)).toBe(true);
    },
  );
});
