import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubReleasesService } from "./github-releases";

const sampleReleases = [
  {
    tag_name: "v1.2.0",
    name: "v1.2.0",
    body: "## Notes\n- thing",
    draft: false,
    prerelease: false,
    published_at: "2026-06-20T00:00:00Z",
    html_url: "https://github.com/PostHog/code/releases/tag/v1.2.0",
  },
  {
    tag_name: "v1.1.0",
    name: "",
    body: null,
    draft: false,
    prerelease: true,
    published_at: "2026-06-10T00:00:00Z",
    html_url: "https://github.com/PostHog/code/releases/tag/v1.1.0",
  },
  {
    tag_name: "v1.3.0-draft",
    name: "draft",
    body: "x",
    draft: true,
    prerelease: false,
    published_at: null,
    html_url: "https://github.com/PostHog/code/releases/tag/v1.3.0-draft",
  },
];

describe("GitHubReleasesService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => sampleReleases,
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps releases, strips the v prefix and drops drafts", async () => {
    const service = new GitHubReleasesService();
    const { releases } = await service.listReleases();

    expect(releases).toHaveLength(2);
    expect(releases[0]).toEqual({
      version: "1.2.0",
      name: "v1.2.0",
      notes: "## Notes\n- thing",
      date: "2026-06-20T00:00:00Z",
      isPrerelease: false,
      htmlUrl: "https://github.com/PostHog/code/releases/tag/v1.2.0",
    });
    // empty name falls back to the tag; null body becomes an empty string
    expect(releases[1]).toMatchObject({
      version: "1.1.0",
      name: "v1.1.0",
      notes: "",
      isPrerelease: true,
    });
  });

  it("caches results within the TTL", async () => {
    const service = new GitHubReleasesService();
    await service.listReleases();
    await service.listReleases();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on non-ok responses", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const service = new GitHubReleasesService();
    await expect(service.listReleases()).rejects.toThrow();
  });

  it("serves stale cache when a later refetch fails", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    const service = new GitHubReleasesService();
    const first = await service.listReleases();

    nowSpy.mockReturnValue(11 * 60_000);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const second = await service.listReleases();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });
});
