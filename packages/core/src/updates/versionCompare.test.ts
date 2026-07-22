import { describe, expect, it } from "vitest";
import { compareVersions, isStrictlyNewer } from "./versionCompare";

describe("compareVersions", () => {
  it.each([
    ["1.2.4", "1.2.3"],
    ["1.3.0", "1.2.9"],
    ["2.0.0", "1.9.9"],
    ["1.2.10", "1.2.9"],
    ["v2.0.0", "v1.0.0"],
    ["1.0.0", "1.0.0-beta.1"],
  ])("reports %s as newer than %s", (a, b) => {
    expect(compareVersions(a, b)).toBeGreaterThan(0);
    expect(compareVersions(b, a)).toBeLessThan(0);
  });

  it.each([
    ["1.2.3", "1.2.3"],
    ["v1.2.3", "1.2.3"],
    ["1.2.3+build.5", "1.2.3+build.9"],
  ])("reports %s and %s as equal", (a, b) => {
    expect(compareVersions(a, b)).toBe(0);
  });

  it("orders prereleases below their final release consistently", () => {
    expect(compareVersions("1.2.0-alpha", "1.2.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.2.0-beta")).toBeGreaterThan(0);
  });

  it("compares numeric prerelease identifiers numerically, not lexically", () => {
    expect(compareVersions("1.2.0-alpha.10", "1.2.0-alpha.9")).toBeGreaterThan(
      0,
    );
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.11")).toBeLessThan(0);
  });

  it("ranks numeric identifiers below alphanumeric and longer sets above shorter", () => {
    // Numeric identifier has lower precedence than an alphanumeric one.
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    // A longer set of identifiers outranks its shorter prefix.
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  it("treats unparseable input as incomparable (equal)", () => {
    expect(compareVersions("not-a-version", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "")).toBe(0);
  });
});

describe("isStrictlyNewer", () => {
  it("is true only when the candidate is strictly newer", () => {
    expect(isStrictlyNewer("1.2.4", "1.2.3")).toBe(true);
    expect(isStrictlyNewer("1.2.3", "1.2.3")).toBe(false);
    expect(isStrictlyNewer("1.2.2", "1.2.3")).toBe(false);
  });

  it("is false when either version is missing", () => {
    expect(isStrictlyNewer(null, "1.2.3")).toBe(false);
    expect(isStrictlyNewer("1.2.3", null)).toBe(false);
    expect(isStrictlyNewer(undefined, undefined)).toBe(false);
  });
});
