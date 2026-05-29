import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  findSkillDirs,
  getMarketplaceInstallPaths,
} from "../skills/skill-discovery";
import type { AgentScopedLogger } from "./ports";

interface DiscoverPluginsOptions {
  userDataDir: string;
  repoPath?: string;
}

const noopLogger: AgentScopedLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export async function discoverExternalPlugins(
  options: DiscoverPluginsOptions,
  log: AgentScopedLogger = noopLogger,
): Promise<SdkPluginConfig[]> {
  const [globalSkills, marketplacePlugins, repoSkills] = await Promise.all([
    discoverUserSkills(options.userDataDir, log),
    discoverMarketplacePlugins(),
    options.repoPath
      ? discoverRepoSkills(options.userDataDir, options.repoPath, log)
      : Promise.resolve([]),
  ]);

  return [...globalSkills, ...marketplacePlugins, ...repoSkills];
}

async function discoverUserSkills(
  userDataDir: string,
  log: AgentScopedLogger,
): Promise<SdkPluginConfig[]> {
  return buildSyntheticPlugin(
    path.join(os.homedir(), ".claude", "skills"),
    path.join(userDataDir, "plugins", "user-skills"),
    "user-skills",
    "User Claude skills",
    log,
  );
}

async function discoverMarketplacePlugins(): Promise<SdkPluginConfig[]> {
  const paths = await getMarketplaceInstallPaths();
  return paths.map((p) => ({ type: "local" as const, path: p }));
}

async function discoverRepoSkills(
  userDataDir: string,
  repoPath: string,
  log: AgentScopedLogger,
): Promise<SdkPluginConfig[]> {
  const skillsDir = path.join(repoPath, ".claude", "skills");
  const hash = crypto
    .createHash("md5")
    .update(repoPath)
    .digest("hex")
    .slice(0, 8);

  return buildSyntheticPlugin(
    skillsDir,
    path.join(userDataDir, "plugins", `repo-skills-${hash}`),
    `repo-skills-${hash}`,
    `Repo skills for ${path.basename(repoPath)}`,
    log,
  );
}

async function buildSyntheticPlugin(
  sourceSkillsDir: string,
  pluginDir: string,
  name: string,
  description: string,
  log: AgentScopedLogger,
): Promise<SdkPluginConfig[]> {
  try {
    const skillDirs = await findSkillDirs(sourceSkillsDir);
    if (skillDirs.length === 0) {
      return [];
    }

    const syntheticSkillsDir = path.join(pluginDir, "skills");
    await fs.promises.mkdir(syntheticSkillsDir, { recursive: true });

    await fs.promises.writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name, description, version: "1.0.0" }),
    );

    try {
      const existing = await fs.promises.readdir(syntheticSkillsDir);
      await Promise.all(
        existing.map((e) =>
          fs.promises.rm(path.join(syntheticSkillsDir, e), {
            recursive: true,
            force: true,
          }),
        ),
      );
    } catch {
      // ignore
    }

    await Promise.all(
      skillDirs.map(async (skillName) => {
        const src = path.join(sourceSkillsDir, skillName);
        const dest = path.join(syntheticSkillsDir, skillName);
        try {
          const realSrc = await fs.promises.realpath(src);
          await fs.promises.symlink(realSrc, dest);
        } catch (err) {
          log.warn("Failed to symlink skill", {
            skillName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    return [{ type: "local", path: pluginDir }];
  } catch (err) {
    log.warn("Failed to discover skills", {
      source: sourceSkillsDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
