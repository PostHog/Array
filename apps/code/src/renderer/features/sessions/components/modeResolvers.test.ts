import { describe, expect, it } from "vitest";

import { resolveBypassRevertMode } from "./modeResolvers";

type ModeOption = Parameters<typeof resolveBypassRevertMode>[0];

/** Build a minimal `select` mode option from a flat list of mode ids. */
function selectMode(values: string[]): ModeOption {
  return {
    type: "select",
    options: values.map((value) => ({ value, label: value })),
  } as unknown as ModeOption;
}

describe("resolveBypassRevertMode", () => {
  it("returns 'default' for a Claude catalog", () => {
    expect(
      resolveBypassRevertMode(
        selectMode(["default", "acceptEdits", "plan", "bypassPermissions"]),
      ),
    ).toBe("default");
  });

  it("returns 'auto' for a Codex catalog (no 'default')", () => {
    expect(
      resolveBypassRevertMode(selectMode(["read-only", "auto", "full-access"])),
    ).toBe("auto");
  });

  it("prefers 'default' over 'auto' when both are advertised", () => {
    expect(resolveBypassRevertMode(selectMode(["auto", "default"]))).toBe(
      "default",
    );
  });

  it("returns undefined when neither standard mode is available", () => {
    expect(resolveBypassRevertMode(selectMode(["plan", "read-only"]))).toBe(
      undefined,
    );
  });

  it("returns undefined for a non-select mode option", () => {
    expect(resolveBypassRevertMode(undefined)).toBe(undefined);
    expect(
      resolveBypassRevertMode({ type: "text" } as unknown as ModeOption),
    ).toBe(undefined);
  });
});
