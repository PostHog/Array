// Profile photos for PostHog staff, sourced from posthog.com/people.
//
// posthog.com is a Gatsby site with no public team API: the roster ships as a
// build-time static-query artifact at page-data/sq/d/<hash>.json. The hash is
// a content hash of the site's GraphQL query — stable across deploys but not
// a contract — so we try the known hash first and fall back to scanning the
// hashes the /people page manifest declares. Every failure degrades to "no
// avatar" and callers keep their initials fallback.
//
// The roster carries no email or other machine join key, only names, so
// matching is by normalized name — and only attempted for @posthog.com
// accounts, so namesakes in other orgs never pick up a staff photo.

const PAGE_DATA_BASE = "https://posthog.com/page-data";
const KNOWN_TEAM_QUERY_HASH = "2290419275";

export interface TeamProfile {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

/** The `UserBasic` fields matching needs; structural so any user-ish shape fits. */
export interface TeamAvatarUser {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

export interface TeamAvatarIndex {
  byFullName: ReadonlyMap<string, string>;
  /** "first l" — matches app accounts whose last name is a bare initial. */
  byFirstAndInitial: ReadonlyMap<string, string>;
  byFirstName: ReadonlyMap<string, string>;
}

function normalizeNamePart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sqQueryUrl(hash: string): string {
  return `${PAGE_DATA_BASE}/sq/d/${hash}.json`;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extract profiles from a static-query payload. Returns [] when the payload
 * isn't the team roster query, which is how the hash scan tells them apart.
 */
export function parseTeamProfiles(payload: unknown): TeamProfile[] {
  const team = asRecord(asRecord(asRecord(payload)?.data)?.team);
  const members = team?.teamMembers;
  if (!Array.isArray(members)) return [];
  const profiles: TeamProfile[] = [];
  for (const member of members) {
    const record = asRecord(member);
    if (!record || typeof record.firstName !== "string") continue;
    const avatar = asRecord(record.avatar);
    // The flat sq/d payload uses avatar.url; Strapi's nested GraphQL shape
    // (avatar.data.attributes.url) is handled too in case the query changes.
    const nested = asRecord(asRecord(avatar?.data)?.attributes);
    const url = avatar?.url ?? nested?.url;
    profiles.push({
      firstName: record.firstName,
      lastName: typeof record.lastName === "string" ? record.lastName : "",
      avatarUrl: typeof url === "string" ? url : null,
    });
  }
  return profiles;
}

/**
 * Fetch the current roster. Never throws — resolves to [] when the site
 * layout has drifted or the network is down.
 */
export async function fetchTeamProfiles(): Promise<TeamProfile[]> {
  const known = parseTeamProfiles(
    await fetchJson(sqQueryUrl(KNOWN_TEAM_QUERY_HASH)),
  );
  if (known.length > 0) return known;

  // The known hash broke (site's GraphQL query changed). The page manifest
  // lists every static-query hash the /people page uses; the roster query is
  // one of them, so probe until a payload parses.
  const manifest = asRecord(
    await fetchJson(`${PAGE_DATA_BASE}/people/page-data.json`),
  );
  const hashes = Array.isArray(manifest?.staticQueryHashes)
    ? manifest.staticQueryHashes.filter(
        (h): h is string => typeof h === "string",
      )
    : [];
  for (const hash of hashes) {
    if (hash === KNOWN_TEAM_QUERY_HASH) continue;
    const profiles = parseTeamProfiles(await fetchJson(sqQueryUrl(hash)));
    if (profiles.length > 0) return profiles;
  }
  return [];
}

function addKey(
  map: Map<string, string | null>,
  key: string,
  url: string,
): void {
  if (!key) return;
  const existing = map.get(key);
  // Two different people sharing a key makes it ambiguous — drop it rather
  // than show the wrong face.
  if (existing !== undefined && existing !== url) {
    map.set(key, null);
    return;
  }
  map.set(key, url);
}

function settle(map: Map<string, string | null>): ReadonlyMap<string, string> {
  const settled = new Map<string, string>();
  for (const [key, url] of map) {
    if (url !== null) settled.set(key, url);
  }
  return settled;
}

export function buildTeamAvatarIndex(profiles: TeamProfile[]): TeamAvatarIndex {
  const byFullName = new Map<string, string | null>();
  const byFirstAndInitial = new Map<string, string | null>();
  const byFirstName = new Map<string, string | null>();
  for (const profile of profiles) {
    if (!profile.avatarUrl) continue;
    const first = normalizeNamePart(profile.firstName);
    const last = normalizeNamePart(profile.lastName);
    if (!first) continue;
    if (last) addKey(byFullName, `${first} ${last}`, profile.avatarUrl);
    if (last)
      addKey(byFirstAndInitial, `${first} ${last[0]}`, profile.avatarUrl);
    addKey(byFirstName, first, profile.avatarUrl);
  }
  return {
    byFullName: settle(byFullName),
    byFirstAndInitial: settle(byFirstAndInitial),
    byFirstName: settle(byFirstName),
  };
}

/**
 * The posthog.com avatar for an app user, or null when there's no confident
 * match. A full last name must match exactly; a single-letter last name
 * matches by initial; no last name matches by unique first name.
 */
export function teamAvatarUrl(
  index: TeamAvatarIndex,
  user: TeamAvatarUser | null | undefined,
): string | null {
  if (!user?.email?.toLowerCase().endsWith("@posthog.com")) return null;
  const first = normalizeNamePart(user.first_name);
  if (!first) return null;
  const last = normalizeNamePart(user.last_name);
  if (last.length > 1) return index.byFullName.get(`${first} ${last}`) ?? null;
  if (last.length === 1) {
    return index.byFirstAndInitial.get(`${first} ${last}`) ?? null;
  }
  return index.byFirstName.get(first) ?? null;
}

/**
 * A right-sized Cloudinary thumb of a roster avatar (the originals are
 * full-resolution uploads). Non-Cloudinary URLs pass through untouched.
 */
export function teamAvatarThumbUrl(url: string, sizePx = 64): string {
  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (!url.startsWith("https://res.cloudinary.com/") || at === -1) return url;
  const px = sizePx * 2;
  const insert = `c_fill,g_face,w_${px},h_${px},q_auto/`;
  return `${url.slice(0, at + marker.length)}${insert}${url.slice(at + marker.length)}`;
}
