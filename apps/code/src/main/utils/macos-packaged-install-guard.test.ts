import { describe, expect, it, vi } from "vitest";
import {
  isMacosAppTranslocationPath,
  isMacosPackagedUnsafeBundleLocation,
  isMacosPathOnReadOnlyNonRootMountFromTable,
  parseDarwinMountTable,
} from "./macos-packaged-install-guard";

describe("isMacosAppTranslocationPath", () => {
  it("returns true when appPath contains AppTranslocation", () => {
    expect(
      isMacosAppTranslocationPath(
        "/private/var/folders/yf/xx/AppTranslocation/C6283C3C-9D6E-4D81-A7D5-8BA2567ED486/d/PostHog Code.app/Contents/Resources/app.asar",
        "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code",
      ),
    ).toBe(true);
  });

  it("returns true when exePath contains AppTranslocation", () => {
    expect(
      isMacosAppTranslocationPath(
        "/Applications/PostHog Code.app/Contents/Resources/app.asar",
        "/private/var/folders/yf/xx/AppTranslocation/C6283C3C/d/PostHog Code.app/Contents/MacOS/PostHog Code",
      ),
    ).toBe(true);
  });

  it("returns false for normal /Applications paths", () => {
    expect(
      isMacosAppTranslocationPath(
        "/Applications/PostHog Code.app/Contents/Resources/app.asar",
        "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code",
      ),
    ).toBe(false);
  });

  it("returns false when neither path is translocated", () => {
    expect(
      isMacosAppTranslocationPath(
        "/Users/dev/PostHog Code.app/Contents/Resources/app.asar",
        "/Users/dev/PostHog Code.app/Contents/MacOS/PostHog Code",
      ),
    ).toBe(false);
  });
});

describe("parseDarwinMountTable", () => {
  it("parses standard macOS mount lines", () => {
    const sample = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk7s1 on /Volumes/My Dmg (apfs, local, read-only, journaled)
/dev/disk5s1 on /Volumes/Writable (apfs, local, journaled)
`;
    const entries = parseDarwinMountTable(sample);
    expect(entries).toEqual([
      { mountPoint: "/", options: "apfs, sealed, local, read-only, journaled" },
      {
        mountPoint: "/Volumes/My Dmg",
        options: "apfs, local, read-only, journaled",
      },
      { mountPoint: "/Volumes/Writable", options: "apfs, local, journaled" },
    ]);
  });
});

describe("isMacosPathOnReadOnlyNonRootMountFromTable", () => {
  const table = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk7s1 on /Volumes/ReadOnlyVol (apfs, local, read-only, journaled)
/dev/disk5s1 on /Volumes/Writable (apfs, local, journaled)
`;

  it("returns false for paths only under read-only / (root is ignored)", () => {
    expect(
      isMacosPathOnReadOnlyNonRootMountFromTable("/Users/me/app", table),
    ).toBe(false);
    expect(
      isMacosPathOnReadOnlyNonRootMountFromTable(
        "/Applications/Foo.app",
        table,
      ),
    ).toBe(false);
  });

  it("returns true for paths on a read-only non-root volume", () => {
    expect(
      isMacosPathOnReadOnlyNonRootMountFromTable(
        "/Volumes/ReadOnlyVol/PostHog Code.app/Contents/MacOS/PostHog Code",
        table,
      ),
    ).toBe(true);
  });

  it("returns false for paths on a writable volume", () => {
    expect(
      isMacosPathOnReadOnlyNonRootMountFromTable(
        "/Volumes/Writable/out/PostHog Code.app/Contents/MacOS/PostHog Code",
        table,
      ),
    ).toBe(false);
  });

  it("picks the longest matching mount prefix", () => {
    const nested = `/dev/x on / (apfs, read-only)
/dev/y on /Volumes/RW (apfs, local, journaled)
/dev/z on /Volumes/RW/nested (apfs, local, read-only)
`;
    expect(
      isMacosPathOnReadOnlyNonRootMountFromTable(
        "/Volumes/RW/nested/app",
        nested,
      ),
    ).toBe(true);
    expect(
      isMacosPathOnReadOnlyNonRootMountFromTable(
        "/Volumes/RW/other/app",
        nested,
      ),
    ).toBe(false);
  });
});

describe("isMacosPackagedUnsafeBundleLocation", () => {
  const writableMountTable = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk5s1 on /Volumes/build (apfs, local, journaled)
/dev/disk6s1 on /Applications (apfs, local, journaled)
`;
  const readOnlyMountTable = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk7s1 on /Volumes/ReadOnlyVol (apfs, local, read-only, journaled)
`;

  it("is true when translocated (mount table never consulted)", () => {
    const readMountTable = vi.fn(() => writableMountTable);
    expect(
      isMacosPackagedUnsafeBundleLocation(
        "/private/var/.../AppTranslocation/UUID/d/PostHog Code.app/Contents/Resources/app.asar",
        "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code",
        readMountTable,
      ),
    ).toBe(true);
    expect(readMountTable).not.toHaveBeenCalled();
  });

  it("is false for ordinary non-translocated paths on writable mounts", () => {
    expect(
      isMacosPackagedUnsafeBundleLocation(
        "/Volumes/build/out/PostHog Code.app/Contents/Resources/app.asar",
        "/Volumes/build/out/PostHog Code.app/Contents/MacOS/PostHog Code",
        () => writableMountTable,
      ),
    ).toBe(false);
  });

  it("is true when the bundle lives on a read-only non-root volume", () => {
    expect(
      isMacosPackagedUnsafeBundleLocation(
        "/Volumes/ReadOnlyVol/PostHog Code.app/Contents/Resources/app.asar",
        "/Volumes/ReadOnlyVol/PostHog Code.app/Contents/MacOS/PostHog Code",
        () => readOnlyMountTable,
      ),
    ).toBe(true);
  });

  it("is false when the mount table cannot be read (degrade to non-blocking)", () => {
    expect(
      isMacosPackagedUnsafeBundleLocation(
        "/Applications/PostHog Code.app/Contents/Resources/app.asar",
        "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code",
        () => null,
      ),
    ).toBe(false);
  });
});
