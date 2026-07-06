import { injectable } from "inversify";
import { githubReleasesApiResponse, type ListReleasesOutput } from "./schemas";

const RELEASES_URL =
  "https://api.github.com/repos/PostHog/code/releases?per_page=30";
const CACHE_TTL_MS = 10 * 60_000;
const MISSING_VERSION_RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

@injectable()
export class GitHubReleasesService {
  private cache: { fetchedAt: number; data: ListReleasesOutput } | null = null;
  private missingVersionRefetchNotBefore = 0;

  async listReleases(expectVersion?: string): Promise<ListReleasesOutput> {
    const normalizedVersion = expectVersion?.replace(/^v/, "");
    if (this.canServeFromCache(normalizedVersion)) {
      // biome-ignore lint/style/noNonNullAssertion: cache is non-null when canServeFromCache returns true
      return this.cache!.data;
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
      this.updateMissingVersionCooldown(normalizedVersion);
      return data;
    } catch (error) {
      if (this.cache) {
        this.updateMissingVersionCooldown(normalizedVersion);
        return this.cache.data;
      }
      throw error;
    }
  }

  // The cooldown only ever matters within an already-valid TTL window:
  // once the cache expires the TTL check short-circuits first, so the
  // cooldown naturally resets on the next successful fetch.
  private canServeFromCache(expectVersion?: string): boolean {
    if (!this.cache || Date.now() - this.cache.fetchedAt >= CACHE_TTL_MS) {
      return false;
    }
    // No version requirement: any fresh cache is fine.
    if (expectVersion === undefined) return true;
    // Version present in cache: serve it.
    if (this.cacheContains(expectVersion)) return true;
    // Version missing but cooldown active: suppress the refetch.
    // The cooldown is a single scalar (not keyed per version) — safe because
    // cacheContains already short-circuits above when the version is found,
    // so the cooldown is only consulted while the version is absent.
    return Date.now() < this.missingVersionRefetchNotBefore;
  }

  private cacheContains(version: string): boolean {
    return (
      this.cache?.data.releases.some(
        (release) => release.version === version,
      ) ?? false
    );
  }

  private updateMissingVersionCooldown(
    expectVersion: string | undefined,
  ): void {
    if (expectVersion !== undefined && !this.cacheContains(expectVersion)) {
      this.missingVersionRefetchNotBefore =
        Date.now() + MISSING_VERSION_RETRY_MS;
    }
  }
}
