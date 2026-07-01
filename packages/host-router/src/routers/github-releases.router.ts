import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { GitHubReleasesService } from "@posthog/workspace-server/services/github-releases/github-releases";
import { GITHUB_RELEASES_SERVICE } from "@posthog/workspace-server/services/github-releases/identifiers";
import { listReleasesOutput } from "@posthog/workspace-server/services/github-releases/schemas";

export const githubReleasesRouter = router({
  list: publicProcedure
    .output(listReleasesOutput)
    .query(({ ctx }) =>
      ctx.container
        .get<GitHubReleasesService>(GITHUB_RELEASES_SERVICE)
        .listReleases(),
    ),
});
