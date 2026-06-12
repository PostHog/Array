import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inject, injectable } from "inversify";
import { WATCHER_SERVICE } from "../../di/tokens";
import type { FoldersService } from "../folders/folders";
import { FOLDERS_SERVICE } from "../folders/identifiers";
import { POSTHOG_PLUGIN_SERVICE } from "../posthog-plugin/identifiers";
import type { PosthogPluginService } from "../posthog-plugin/posthog-plugin";
import type { WatcherService } from "../watcher/service";
import { parseSkillFrontmatter } from "./parse-skill-frontmatter";
import type {
  CreateSkillInput,
  SkillContents,
  SkillInfo,
  SkillSource,
} from "./schemas";
import {
  getMarketplaceInstallPaths,
  listSkillFiles,
  readSkillMetadataFromDir,
} from "./skill-discovery";
import { serializeSkillMarkdown } from "./write-skill-frontmatter";

const MAX_SKILL_FILES = 500;
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;
const SKILLS_WATCH_DEBOUNCE_MS = 300;
const MISSING_DIR_POLL_MS = 2000;
const SKILL_DIR_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_SKILL_DIR_NAME_LENGTH = 64;

const SKILL_MD_TEMPLATE_BODY = `Explain when this skill applies and how to use it.

## Instructions

1. ...
`;

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
    @inject(WATCHER_SERVICE)
    private readonly watcher: WatcherService,
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
    const resolved = resolveSkillFilePath(skillDir, filePath);
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

  async createSkill(options: CreateSkillInput): Promise<{ path: string }> {
    const name = options.name.trim();
    validateSkillDirName(name);

    const root = await this.resolveWritableRoot(
      options.scope,
      options.repoPath,
    );
    const skillPath = path.join(root, name);
    if (fs.existsSync(skillPath)) {
      throw new Error(`A skill named "${name}" already exists`);
    }

    await fs.promises.mkdir(skillPath, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillPath, "SKILL.md"),
      serializeSkillMarkdown({ name, description: "" }, SKILL_MD_TEMPLATE_BODY),
      "utf-8",
    );
    return { path: skillPath };
  }

  async saveSkillManifest(
    skillPath: string,
    manifest: { name: string; description: string; body: string },
  ): Promise<void> {
    const skillDir = await this.resolveWritableSkillDir(skillPath);
    const content = serializeSkillMarkdown(
      { name: manifest.name.trim(), description: manifest.description.trim() },
      manifest.body,
    );
    // The writer and parser must agree, or the skill vanishes from the list.
    if (!parseSkillFrontmatter(content)) {
      throw new Error("Skill name is required");
    }
    await fs.promises.writeFile(
      path.join(skillDir, "SKILL.md"),
      content,
      "utf-8",
    );
  }

  async saveSkillFile(
    skillPath: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const skillDir = await this.resolveWritableSkillDir(skillPath);
    const target = resolveSkillFilePath(skillDir, filePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content, "utf-8");
  }

  async renameSkillFile(
    skillPath: string,
    fromPath: string,
    toPath: string,
  ): Promise<void> {
    const skillDir = await this.resolveWritableSkillDir(skillPath);
    const from = resolveSkillFilePath(skillDir, fromPath);
    const to = resolveSkillFilePath(skillDir, toPath);
    if (from === path.join(skillDir, "SKILL.md")) {
      throw new Error("SKILL.md cannot be renamed");
    }
    if (fs.existsSync(to)) {
      throw new Error(`"${toPath}" already exists`);
    }
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.rename(from, to);
  }

  async deleteSkillFile(skillPath: string, filePath: string): Promise<void> {
    const skillDir = await this.resolveWritableSkillDir(skillPath);
    const target = resolveSkillFilePath(skillDir, filePath);
    if (target === path.join(skillDir, "SKILL.md")) {
      throw new Error("SKILL.md cannot be deleted");
    }
    await fs.promises.rm(target, { force: true });
  }

  async deleteSkill(skillPath: string): Promise<void> {
    const skillDir = await this.resolveWritableSkillDir(skillPath);
    await fs.promises.rm(skillDir, { recursive: true, force: true });
  }

  /**
   * Emits a debounced "skills changed" event whenever anything inside the
   * writable skill roots changes on disk (external editors, agent sessions,
   * `touch` from a terminal, ...).
   */
  async *watchSkills(signal?: AbortSignal): AsyncGenerator<{ changed: true }> {
    const userRoot = path.join(os.homedir(), ".claude", "skills");
    // The user root is ours to create; missing repo roots are polled for.
    await fs.promises.mkdir(userRoot, { recursive: true }).catch(() => {});
    const folders = await this.folders.getFolders();
    const dirs = [
      userRoot,
      ...folders.map((f) => path.join(f.path, ".claude", "skills")),
    ];

    yield* this.watchSkillDirs(dirs, signal);
  }

  /**
   * Merges watchers over the given directories into one debounced stream.
   * Directories that don't exist yet are polled until they appear.
   */
  async *watchSkillDirs(
    dirs: string[],
    signal?: AbortSignal,
  ): AsyncGenerator<{ changed: true }> {
    if (dirs.length === 0) return;

    let pending = false;
    let finished = 0;
    let notify: (() => void) | undefined;
    const wake = () => notify?.();

    for (const dir of dirs) {
      void (async () => {
        try {
          if (!(await dirExists(dir))) {
            if (!(await waitForDir(dir, signal))) return;
            pending = true;
            wake();
          }
          for await (const _batch of this.watcher.watch(dir, {}, signal)) {
            pending = true;
            wake();
          }
        } catch {
          // A failed watcher on one root must not break the others.
        } finally {
          finished++;
          wake();
        }
      })();
    }

    while (finished < dirs.length && !signal?.aborted) {
      if (!pending) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = undefined;
        continue;
      }
      // Collapse bursts of file events into a single notification.
      await delay(SKILLS_WATCH_DEBOUNCE_MS, signal);
      if (signal?.aborted) return;
      pending = false;
      yield { changed: true };
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

  private async getWritableRoots(): Promise<string[]> {
    const folders = await this.folders.getFolders();
    return [
      path.join(os.homedir(), ".claude", "skills"),
      ...folders.map((f) => path.join(f.path, ".claude", "skills")),
    ];
  }

  private async resolveWritableRoot(
    scope: "user" | "repo",
    repoPath: string | undefined,
  ): Promise<string> {
    if (scope === "user") {
      return path.join(os.homedir(), ".claude", "skills");
    }
    const folders = await this.folders.getFolders();
    const folder = folders.find(
      (f) => repoPath && path.resolve(f.path) === path.resolve(repoPath),
    );
    if (!folder) {
      throw new Error("Access denied: not an open workspace folder");
    }
    return path.join(folder.path, ".claude", "skills");
  }

  /**
   * Hard guard for every mutation: the target must be a skill directory
   * directly under a writable root (the user's `~/.claude/skills` or a
   * workspace folder's `.claude/skills`). Bundled skills, plugin install
   * paths, and anything else are rejected here, not in the UI.
   */
  private async resolveWritableSkillDir(skillPath: string): Promise<string> {
    const resolved = path.resolve(skillPath);
    const roots = await this.getWritableRoots();
    const parent = path.dirname(resolved);
    if (!roots.some((root) => path.resolve(root) === parent)) {
      throw new Error("Access denied: skill is not in a writable location");
    }
    if (!fs.existsSync(path.join(resolved, "SKILL.md"))) {
      throw new Error("Access denied: not a known skill directory");
    }
    return resolved;
  }
}

function validateSkillDirName(name: string): void {
  if (
    !SKILL_DIR_NAME_PATTERN.test(name) ||
    name.length > MAX_SKILL_DIR_NAME_LENGTH
  ) {
    throw new Error(
      "Skill names must be lowercase letters, numbers, dots, dashes, or underscores",
    );
  }
}

function dirExists(dir: string): Promise<boolean> {
  return fs.promises
    .access(dir)
    .then(() => true)
    .catch(() => false);
}

/** Polls until the directory exists. Resolves false if aborted first. */
async function waitForDir(dir: string, signal?: AbortSignal): Promise<boolean> {
  while (!signal?.aborted) {
    if (await dirExists(dir)) return true;
    await delay(MISSING_DIR_POLL_MS, signal);
  }
  return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function resolveSkillFilePath(skillDir: string, filePath: string): string {
  const resolved = path.resolve(skillDir, filePath);
  if (resolved === skillDir || !resolved.startsWith(skillDir + path.sep)) {
    throw new Error("Access denied: path outside skill directory");
  }
  return resolved;
}
