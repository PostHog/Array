import * as os from "node:os";
import * as path from "node:path";
import { inject, injectable } from "inversify";
import type { FoldersService } from "../folders/folders";
import { FOLDERS_SERVICE } from "../folders/identifiers";
import { POSTHOG_PLUGIN_SERVICE } from "../posthog-plugin/identifiers";
import type { PosthogPluginService } from "../posthog-plugin/posthog-plugin";
import type { SkillInfo } from "./schemas";
import {
  getMarketplaceInstallPaths,
  readSkillMetadataFromDir,
} from "./skill-discovery";

@injectable()
export class SkillsService {
  constructor(
    @inject(POSTHOG_PLUGIN_SERVICE)
    private readonly plugin: PosthogPluginService,
    @inject(FOLDERS_SERVICE)
    private readonly folders: FoldersService,
  ) {}

  async listSkills(): Promise<SkillInfo[]> {
    const pluginPath = this.plugin.getPluginPath();
    const folders = await this.folders.getFolders();
    const marketplacePaths = await getMarketplaceInstallPaths();

    const results = await Promise.all([
      readSkillMetadataFromDir(path.join(pluginPath, "skills"), "bundled"),
      readSkillMetadataFromDir(
        path.join(os.homedir(), ".claude", "skills"),
        "user",
      ),
      ...folders.map((f) =>
        readSkillMetadataFromDir(
          path.join(f.path, ".claude", "skills"),
          "repo",
          f.name,
        ),
      ),
      ...marketplacePaths.map((p) =>
        readSkillMetadataFromDir(path.join(p, "skills"), "marketplace"),
      ),
    ]);

    return results.flat();
  }
}
