import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTeamAvatarIndex,
  fetchTeamProfiles,
  parseTeamProfiles,
  teamAvatarThumbUrl,
  teamAvatarUrl,
} from "./teamProfiles";

const CLOUDINARY = "https://res.cloudinary.com/dmukukwp6/image/upload";

function rosterPayload(
  members: Array<{ firstName: string; lastName?: string; url?: string | null }>,
) {
  return {
    data: {
      team: {
        teamMembers: members.map((m) => ({
          firstName: m.firstName,
          lastName: m.lastName,
          avatar:
            m.url === null
              ? null
              : { url: m.url ?? `${CLOUDINARY}/v1/${m.firstName}.png` },
        })),
      },
    },
  };
}

describe("parseTeamProfiles", () => {
  it("extracts flat sq/d payload profiles", () => {
    const profiles = parseTeamProfiles(
      rosterPayload([{ firstName: "James", lastName: "Hawkins" }]),
    );
    expect(profiles).toEqual([
      {
        firstName: "James",
        lastName: "Hawkins",
        avatarUrl: `${CLOUDINARY}/v1/James.png`,
      },
    ]);
  });

  it("reads the nested Strapi avatar shape", () => {
    const profiles = parseTeamProfiles({
      data: {
        team: {
          teamMembers: [
            {
              firstName: "Raquel",
              lastName: "Smith",
              avatar: { data: { attributes: { url: "https://x/r.png" } } },
            },
          ],
        },
      },
    });
    expect(profiles[0]?.avatarUrl).toBe("https://x/r.png");
  });

  it.each([
    ["null", null],
    ["not the roster query", { data: { posts: [] } }],
    ["members not an array", { data: { team: { teamMembers: {} } } }],
  ])("returns [] for %s", (_label, payload) => {
    expect(parseTeamProfiles(payload)).toEqual([]);
  });

  it("skips malformed members and tolerates a missing avatar", () => {
    const profiles = parseTeamProfiles({
      data: {
        team: {
          teamMembers: [
            null,
            { lastName: "NoFirst" },
            { firstName: "Ava", avatar: null },
          ],
        },
      },
    });
    expect(profiles).toEqual([
      { firstName: "Ava", lastName: "", avatarUrl: null },
    ]);
  });
});

describe("teamAvatarUrl", () => {
  const index = buildTeamAvatarIndex([
    { firstName: "James", lastName: "Hawkins", avatarUrl: "url:james-h" },
    { firstName: "James", lastName: "Greenhill", avatarUrl: "url:james-g" },
    { firstName: "Raquel", lastName: "Smith", avatarUrl: "url:raquel" },
    { firstName: "Zoé", lastName: "Dupont", avatarUrl: "url:zoe" },
    { firstName: "NoPhoto", lastName: "Person", avatarUrl: null },
  ]);

  const posthog = (first?: string | null, last?: string | null) => ({
    first_name: first,
    last_name: last,
    email: "someone@posthog.com",
  });

  it.each([
    ["full name", posthog("James", "Hawkins"), "url:james-h"],
    ["case/diacritic-insensitive", posthog("ZOE", "DUPONT"), "url:zoe"],
    [
      "single-letter last name by initial",
      posthog("James", "G"),
      "url:james-g",
    ],
    ["unique first name only", posthog("Raquel", null), "url:raquel"],
    ["ambiguous first name only", posthog("James", null), null],
    [
      "full last name never falls back to initial",
      posthog("James", "Hawk"),
      null,
    ],
    ["profile without a photo", posthog("NoPhoto", "Person"), null],
    ["missing user", null, null],
  ])("%s", (_label, user, expected) => {
    expect(teamAvatarUrl(index, user)).toBe(expected);
  });

  it("never matches non-posthog.com accounts", () => {
    expect(
      teamAvatarUrl(index, {
        first_name: "James",
        last_name: "Hawkins",
        email: "james.hawkins@example.com",
      }),
    ).toBeNull();
  });
});

describe("teamAvatarThumbUrl", () => {
  it("inserts a fill transform into Cloudinary URLs at 2x", () => {
    expect(
      teamAvatarThumbUrl(`${CLOUDINARY}/v1738943658/James_H.png`, 32),
    ).toBe(
      `${CLOUDINARY}/c_fill,g_face,w_64,h_64,q_auto/v1738943658/James_H.png`,
    );
  });

  it("passes non-Cloudinary URLs through", () => {
    expect(teamAvatarThumbUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
  });
});

describe("fetchTeamProfiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(routes: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!(url in routes)) return { ok: false } as Response;
        return { ok: true, json: async () => routes[url] } as Response;
      }),
    );
  }

  it("uses the known static-query hash when it still resolves", async () => {
    stubFetch({
      "https://posthog.com/page-data/sq/d/2290419275.json": rosterPayload([
        { firstName: "James", lastName: "Hawkins" },
      ]),
    });
    const profiles = await fetchTeamProfiles();
    expect(profiles).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to scanning the /people manifest hashes", async () => {
    stubFetch({
      "https://posthog.com/page-data/people/page-data.json": {
        staticQueryHashes: ["111", "222"],
      },
      "https://posthog.com/page-data/sq/d/111.json": { data: { other: true } },
      "https://posthog.com/page-data/sq/d/222.json": rosterPayload([
        { firstName: "Raquel", lastName: "Smith" },
      ]),
    });
    const profiles = await fetchTeamProfiles();
    expect(profiles.map((p) => p.firstName)).toEqual(["Raquel"]);
  });

  it("resolves to [] when everything is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(fetchTeamProfiles()).resolves.toEqual([]);
  });
});
