import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { GitHubReleasesService } from "@posthog/workspace-server/services/github-releases/github-releases";
import { GITHUB_RELEASES_SERVICE } from "@posthog/workspace-server/services/github-releases/identifiers";
import {
  listReleasesInput,
  listReleasesOutput,
} from "@posthog/workspace-server/services/github-releases/schemas";

export const githubReleasesRouter = router({
  list: publicProcedure
    .input(listReleasesInput)
    .output(listReleasesOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<GitHubReleasesService>(GITHUB_RELEASES_SERVICE)
        .listReleases(input?.expectVersion),
    ),
});
