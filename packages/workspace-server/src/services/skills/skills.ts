import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inject, injectable } from "inversify";
import type { FoldersService } from "../folders/folders";
import { FOLDERS_SERVICE } from "../folders/identifiers";
import { POSTHOG_PLUGIN_SERVICE } from "../posthog-plugin/identifiers";
import type { PosthogPluginService } from "../posthog-plugin/posthog-plugin";
import type { SkillContents, SkillInfo, SkillSource } from "./schemas";
import {
  getMarketplaceInstallPaths,
  listSkillFiles,
  readSkillMetadataFromDir,
} from "./skill-discovery";

const MAX_SKILL_FILES = 500;
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;

interface SkillRoot {
  dir: string;
  source: SkillSource;
  repoName?: string;
}

@injectable()
export class SkillsService {
  constructor(
    @inject(POSTHOG_PLUGIN_SERVICE)
    private readonly plugin: PosthogPluginService,
    @inject(FOLDERS_SERVICE)
    private readonly folders: FoldersService,
  ) {}

  async listSkills(): Promise<SkillInfo[]> {
    const roots = await this.getSkillRoots();
    const results = await Promise.all(
      roots.map((root) =>
        readSkillMetadataFromDir(root.dir, root.source, root.repoName),
      ),
    );
    return results.flat();
  }

  async getSkillContents(skillPath: string): Promise<SkillContents> {
    const skillDir = await this.resolveKnownSkillDir(skillPath);
    const files = await listSkillFiles(skillDir, MAX_SKILL_FILES);
    return { files };
  }

  async readSkillFile(
    skillPath: string,
    filePath: string,
  ): Promise<string | null> {
    const skillDir = await this.resolveKnownSkillDir(skillPath);
    const resolved = path.resolve(skillDir, filePath);
    if (resolved === skillDir || !resolved.startsWith(skillDir + path.sep)) {
      throw new Error("Access denied: path outside skill directory");
    }
    try {
      // realpath also catches escapes via symlinked intermediate directories.
      const [realFile, realDir] = await Promise.all([
        fs.promises.realpath(resolved),
        fs.promises.realpath(skillDir),
      ]);
      if (!realFile.startsWith(realDir + path.sep)) return null;
      const stat = await fs.promises.stat(realFile);
      if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) return null;
      return await fs.promises.readFile(realFile, "utf-8");
    } catch {
      return null;
    }
  }

  private async getSkillRoots(): Promise<SkillRoot[]> {
    const pluginPath = this.plugin.getPluginPath();
    const folders = await this.folders.getFolders();
    const marketplacePaths = await getMarketplaceInstallPaths();

    return [
      { dir: path.join(pluginPath, "skills"), source: "bundled" as const },
      {
        dir: path.join(os.homedir(), ".claude", "skills"),
        source: "user" as const,
      },
      ...folders.map((f) => ({
        dir: path.join(f.path, ".claude", "skills"),
        source: "repo" as const,
        repoName: f.name,
      })),
      ...marketplacePaths.map((p) => ({
        dir: path.join(p, "skills"),
        source: "marketplace" as const,
      })),
    ];
  }

  /**
   * Validates that the given path is a skill directory directly under one of
   * the discovery roots. This keeps the contents/readFile endpoints from
   * becoming arbitrary-filesystem reads.
   */
  private async resolveKnownSkillDir(skillPath: string): Promise<string> {
    const resolved = path.resolve(skillPath);
    const roots = await this.getSkillRoots();
    const parent = path.dirname(resolved);
    const isUnderKnownRoot = roots.some(
      (root) => path.resolve(root.dir) === parent,
    );
    const hasSkillMd =
      isUnderKnownRoot &&
      (await fs.promises
        .access(path.join(resolved, "SKILL.md"))
        .then(() => true)
        .catch(() => false));
    if (!hasSkillMd) {
      throw new Error("Access denied: not a known skill directory");
    }
    return resolved;
  }
}
