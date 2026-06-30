import { ContainerModule } from "inversify";
import { GitHubReleasesService } from "./github-releases";
import { GITHUB_RELEASES_SERVICE } from "./identifiers";

export const githubReleasesModule = new ContainerModule(({ bind }) => {
  bind(GITHUB_RELEASES_SERVICE).to(GitHubReleasesService).inSingletonScope();
});
