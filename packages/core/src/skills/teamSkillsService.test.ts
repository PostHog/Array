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

describe("TeamSkillsService.publishSkill", () => {
  const exported = {
    name: "pr-shepherd",
    description: "Shepherds PRs",
    body: "# Body",
    files: [{ path: "references/guide.md", content: "guide" }],
  };

  it("creates a new skill on first publish", async () => {
    const createLlmSkill = vi.fn().mockResolvedValue(makeItem({ version: 1 }));
    const client = {
      listLlmSkills: vi.fn().mockResolvedValue([]),
      createLlmSkill,
    } as unknown as PostHogAPIClient;

    const result = await new TeamSkillsService().publishSkill(client, exported);

    expect(createLlmSkill).toHaveBeenCalledWith({
      name: "pr-shepherd",
      description: "Shepherds PRs",
      body: "# Body",
      files: exported.files,
    });
    expect(result).toEqual({ version: 1 });
  });

  it("publishes a new version against the current latest", async () => {
    const publishLlmSkillVersion = vi
      .fn()
      .mockResolvedValue(makeItem({ version: 3 }));
    const client = {
      listLlmSkills: vi
        .fn()
        .mockResolvedValue([makeItem({ version: 2, latest_version: 2 })]),
      publishLlmSkillVersion,
    } as unknown as PostHogAPIClient;

    const result = await new TeamSkillsService().publishSkill(client, exported);

    expect(publishLlmSkillVersion).toHaveBeenCalledWith("pr-shepherd", {
      body: "# Body",
      description: "Shepherds PRs",
      files: exported.files,
      base_version: 2,
    });
    expect(result).toEqual({ version: 3 });
  });

  it("rejects publishing without a description", async () => {
    await expect(
      new TeamSkillsService().publishSkill(makeClient([]), {
        ...exported,
        description: "  ",
      }),
    ).rejects.toThrow("Add a description");
  });

  it("rejects publishing when the feature is unavailable", async () => {
    await expect(
      new TeamSkillsService().publishSkill(makeClient(null), exported),
    ).rejects.toThrow("not enabled");
  });
});

describe("TeamSkillsService.fetchSkillForInstall", () => {
  it("fetches the body plus every companion file", async () => {
    const client = {
      getLlmSkillByName: vi.fn().mockResolvedValue({
        name: "pr-shepherd",
        description: "Shepherds PRs",
        body: "# Body",
        files: [
          { path: "references/guide.md", content_type: "text/plain" },
          { path: "scripts/run.sh", content_type: "text/plain" },
        ],
      }),
      getLlmSkillFile: vi
        .fn()
        .mockImplementation(async (_name: string, path: string) => ({
          path,
          content: `content of ${path}`,
          content_type: "text/plain",
        })),
    } as unknown as PostHogAPIClient;

    const skill = await new TeamSkillsService().fetchSkillForInstall(
      client,
      "pr-shepherd",
    );

    expect(skill).toEqual({
      name: "pr-shepherd",
      description: "Shepherds PRs",
      body: "# Body",
      files: [
        {
          path: "references/guide.md",
          content: "content of references/guide.md",
        },
        { path: "scripts/run.sh", content: "content of scripts/run.sh" },
      ],
    });
  });
});
