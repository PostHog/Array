import type {
  LlmSkillListItem,
  PostHogAPIClient,
} from "@posthog/api-client/posthog-client";
import { describe, expect, it, vi } from "vitest";
import { TeamSkillsService } from "./teamSkillsService";

function makeItem(overrides: Partial<LlmSkillListItem>): LlmSkillListItem {
  return {
    id: "skill-1",
    name: "pr-shepherd",
    description: "Shepherds PRs",
    allowed_tools: [],
    metadata: {},
    version: 2,
    is_latest: true,
    latest_version: 2,
    created_by: { email: "dev@posthog.com" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makeClient(result: LlmSkillListItem[] | null): PostHogAPIClient {
  return {
    listLlmSkills: vi
      .fn<PostHogAPIClient["listLlmSkills"]>()
      .mockResolvedValue(result),
  } satisfies Partial<PostHogAPIClient> as unknown as PostHogAPIClient;
}

describe("TeamSkillsService.listTeamSkills", () => {
  it("reports the feature as unavailable when the API returns null", async () => {
    const listing = await new TeamSkillsService().listTeamSkills(
      makeClient(null),
      [],
    );

    expect(listing).toEqual({ available: false, skills: [] });
  });

  it("maps team skills and marks ones that exist locally", async () => {
    const client = makeClient([
      makeItem({}),
      makeItem({ id: "skill-2", name: "release-notes", created_by: null }),
    ]);

    const listing = await new TeamSkillsService().listTeamSkills(client, [
      "release-notes",
      "unrelated-local",
    ]);

    expect(listing.available).toBe(true);
    expect(listing.skills).toEqual([
      {
        id: "skill-1",
        name: "pr-shepherd",
        description: "Shepherds PRs",
        version: 2,
        updatedAt: "2026-02-01T00:00:00Z",
        createdByEmail: "dev@posthog.com",
        installedLocally: false,
      },
      expect.objectContaining({
        name: "release-notes",
        createdByEmail: null,
        installedLocally: true,
      }),
    ]);
  });

  it("drops non-latest versions", async () => {
    const client = makeClient([
      makeItem({ is_latest: false, version: 1 }),
      makeItem({ id: "skill-1b", version: 2 }),
    ]);

    const listing = await new TeamSkillsService().listTeamSkills(client, []);

    expect(listing.skills).toHaveLength(1);
    expect(listing.skills[0]?.id).toBe("skill-1b");
  });
});
