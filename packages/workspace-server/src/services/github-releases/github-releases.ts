import { injectable } from "inversify";
import { githubReleasesApiResponse, type ListReleasesOutput } from "./schemas";

const RELEASES_URL =
  "https://api.github.com/repos/PostHog/code/releases?per_page=30";
const CACHE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

@injectable()
export class GitHubReleasesService {
  private cache: { fetchedAt: number; data: ListReleasesOutput } | null = null;

  async listReleases(): Promise<ListReleasesOutput> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.data;
    }

    try {
      const response = await fetch(RELEASES_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`GitHub releases fetch failed: ${response.status}`);
      }

      const parsed = githubReleasesApiResponse.parse(await response.json());
      const releases = parsed
        .filter((release) => !release.draft)
        .map((release) => ({
          version: release.tag_name.replace(/^v/, ""),
          name:
            release.name && release.name.length > 0
              ? release.name
              : release.tag_name,
          notes: release.body ?? "",
          date: release.published_at,
          isPrerelease: release.prerelease,
          htmlUrl: release.html_url,
        }));

      const data: ListReleasesOutput = { releases };
      this.cache = { fetchedAt: Date.now(), data };
      return data;
    } catch (error) {
      if (this.cache) {
        return this.cache.data;
      }
      throw error;
    }
  }
}
