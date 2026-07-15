import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSpokenNarration } from "./session-meta";

describe("resolveSpokenNarration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      name: "explicit true on local",
      meta: { environment: "local" as const, spokenNarration: true },
      expected: true,
    },
    {
      name: "explicit false on cloud",
      meta: { environment: "cloud" as const, spokenNarration: false },
      expected: false,
    },
    {
      name: "cloud default",
      meta: { environment: "cloud" as const },
      expected: true,
    },
    {
      name: "local default",
      meta: { environment: "local" as const },
      expected: false,
    },
    { name: "no meta", meta: undefined, expected: false },
    { name: "empty meta", meta: {}, expected: false },
  ])("resolves $name to $expected outside a sandbox", ({ meta, expected }) => {
    vi.stubEnv("IS_SANDBOX", "");
    expect(resolveSpokenNarration(meta)).toBe(expected);
  });

  it.each([
    { name: "no meta", meta: undefined, expected: true },
    { name: "empty meta", meta: {}, expected: true },
    {
      name: "explicit false",
      meta: { spokenNarration: false },
      expected: false,
    },
    {
      name: "explicit local environment",
      meta: { environment: "local" as const },
      expected: false,
    },
  ])(
    "resolves $name to $expected in a sandbox without an environment tag",
    ({ meta, expected }) => {
      vi.stubEnv("IS_SANDBOX", "1");
      expect(resolveSpokenNarration(meta)).toBe(expected);
    },
  );
});
