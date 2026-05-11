import { execFileSync } from "node:child_process";
import path from "node:path";

const APP_TRANSLOCATION_SEGMENT = "AppTranslocation";

export type DarwinMountEntry = {
  mountPoint: string;
  options: string;
};

/** Parse `/sbin/mount` lines: `<device> on <mountPoint> (<opts>)` */
export function parseDarwinMountTable(output: string): DarwinMountEntry[] {
  const entries: DarwinMountEntry[] = [];
  for (const line of output.split("\n")) {
    const onMarker = line.indexOf(" on ");
    if (onMarker === -1) continue;
    const afterOn = line.slice(onMarker + 4);
    const openParen = afterOn.indexOf(" (");
    if (openParen === -1 || !line.endsWith(")")) continue;
    const mountPoint = afterOn.slice(0, openParen);
    const options = afterOn.slice(openParen + 2, -1);
    entries.push({ mountPoint, options });
  }
  return entries;
}

function mountOptionsImplyReadOnly(options: string): boolean {
  return options.toLowerCase().includes("read-only");
}

function longestMatchingMount(
  resolvedPath: string,
  entries: DarwinMountEntry[],
): DarwinMountEntry | null {
  let best: DarwinMountEntry | null = null;
  for (const e of entries) {
    const mp = e.mountPoint;
    const under = resolvedPath === mp || resolvedPath.startsWith(`${mp}/`);
    if (!under) continue;
    if (!best || mp.length > best.mountPoint.length) {
      best = e;
    }
  }
  return best;
}

/**
 * True when `resolvedAbsolutePath` sits on a **non-root** mount that `mount(8)`
 * reports as read-only (e.g. many DMGs, some external volumes).
 *
 * Ignores read-only `/` — on sealed macOS the system volume is read-only while
 * normal apps under /Applications or /Users still work.
 */
export function isMacosPathOnReadOnlyNonRootMountFromTable(
  resolvedAbsolutePath: string,
  mountTable: string,
): boolean {
  const normalized = path.resolve(resolvedAbsolutePath);
  const entries = parseDarwinMountTable(mountTable);
  const best = longestMatchingMount(normalized, entries);
  if (!best || best.mountPoint === "/") {
    return false;
  }
  return mountOptionsImplyReadOnly(best.options);
}

function isMacosPathOnReadOnlyNonRootMount(
  resolvedAbsolutePath: string,
): boolean {
  let output: string;
  try {
    output = execFileSync("/sbin/mount", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return isMacosPathOnReadOnlyNonRootMountFromTable(
    resolvedAbsolutePath,
    output,
  );
}

/**
 * True when either path is under macOS App Translocation (read-only runtime).
 * Caller should gate on packaged darwin before using this to block startup.
 */
export function isMacosAppTranslocationPath(
  appPath: string,
  exePath: string,
): boolean {
  return (
    appPath.includes(APP_TRANSLOCATION_SEGMENT) ||
    exePath.includes(APP_TRANSLOCATION_SEGMENT)
  );
}

/** Packaged macOS: translocated bundle path, or binary on a non-root read-only mount (see mount(8)). */
export function isMacosPackagedUnsafeBundleLocation(
  appPath: string,
  exePath: string,
): boolean {
  if (isMacosAppTranslocationPath(appPath, exePath)) {
    return true;
  }
  return isMacosPathOnReadOnlyNonRootMount(path.resolve(exePath));
}
