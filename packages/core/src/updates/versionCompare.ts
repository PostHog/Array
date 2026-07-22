type ParsedVersion = {
  release: [number, number, number];
  prerelease: string | null;
};

function parseVersion(input: string): ParsedVersion | null {
  const trimmed = input.trim().replace(/^v/i, "");
  if (trimmed.length === 0) return null;

  const [coreWithBuild, ...prereleaseParts] = trimmed.split("-");
  const core = coreWithBuild.split("+")[0];
  const segments = core.split(".");

  const release: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const segment = segments[i] ?? "0";
    const value = Number(segment);
    if (!Number.isInteger(value) || value < 0) return null;
    release[i] = value;
  }

  return {
    release,
    prerelease: prereleaseParts.length > 0 ? prereleaseParts.join("-") : null,
  };
}

/**
 * Compare two semver-like version strings.
 *
 * Returns a positive number if `a` is newer than `b`, a negative number if it
 * is older, and 0 if they are equal or cannot be compared. Tolerates a leading
 * "v", ignores build metadata, and treats a prerelease (e.g. "1.2.0-beta.1") as
 * older than its final release ("1.2.0"). Anything that fails to parse compares
 * as equal so callers never act on garbage input.
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return 0;

  for (let i = 0; i < 3; i++) {
    if (parsedA.release[i] !== parsedB.release[i]) {
      return parsedA.release[i] - parsedB.release[i];
    }
  }

  if (parsedA.prerelease === parsedB.prerelease) return 0;
  // A final release outranks any prerelease of the same core version.
  if (parsedA.prerelease === null) return 1;
  if (parsedB.prerelease === null) return -1;
  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
}

// Compare two prerelease strings per semver §11: dot-separated identifiers,
// numeric ones compared numerically, numeric ranked below alphanumeric, and a
// longer set of identifiers ranked above a shorter prefix of it.
function comparePrerelease(a: string, b: string): number {
  const aIds = a.split(".");
  const bIds = b.split(".");
  const length = Math.max(aIds.length, bIds.length);

  for (let i = 0; i < length; i++) {
    if (i >= aIds.length) return -1;
    if (i >= bIds.length) return 1;

    const aId = aIds[i];
    const bId = bIds[i];
    const aNumeric = /^\d+$/.test(aId);
    const bNumeric = /^\d+$/.test(bId);

    if (aNumeric && bNumeric) {
      const diff = Number(aId) - Number(bId);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (aId !== bId) {
      return aId < bId ? -1 : 1;
    }
  }

  return 0;
}

/**
 * True when `candidate` is a strictly newer version than `current`. Missing
 * values (either side null/undefined) are treated as "not newer" so we never
 * supersede a known update on the basis of an unknown version.
 */
export function isStrictlyNewer(
  candidate: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!candidate || !current) return false;
  return compareVersions(candidate, current) > 0;
}
