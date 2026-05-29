import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSkillFrontmatter } from "./parse-skill-frontmatter";
import type { SkillInfo, SkillSource } from "./schemas";

interface InstalledPluginEntry {
  scope: string;
  installPath: string;
  version: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

export async function findSkillDirs(
  sourceSkillsDir: string,
): Promise<string[]> {
  if (!fs.existsSync(sourceSkillsDir)) {
    return [];
  }

  const entries = await fs.promises.readdir(sourceSkillsDir, {
    withFileTypes: true,
  });

  return entries
    .filter(
      (e) =>
        (e.isDirectory() || e.isSymbolicLink()) &&
        fs.existsSync(path.join(sourceSkillsDir, e.name, "SKILL.md")),
    )
    .map((e) => e.name);
}

export async function getMarketplaceInstallPaths(): Promise<string[]> {
  const installedPath = path.join(
    os.homedir(),
    ".claude",
    "plugins",
    "installed_plugins.json",
  );

  try {
    const content = await fs.promises.readFile(installedPath, "utf-8");
    const data = JSON.parse(content) as InstalledPluginsFile;

    if (!data.plugins || typeof data.plugins !== "object") {
      return [];
    }

    const paths: string[] = [];
    for (const [key, entries] of Object.entries(data.plugins)) {
      if (!Array.isArray(entries)) continue;
      // Skip the marketplace posthog plugin — the app bundles its own.
      if (key.split("@")[0] === "posthog") continue;
      for (const entry of entries) {
        if (entry.installPath && fs.existsSync(entry.installPath)) {
          paths.push(entry.installPath);
        }
      }
    }
    return paths;
  } catch {
    return [];
  }
}

export async function readSkillMetadataFromDir(
  skillsDir: string,
  source: SkillSource,
  repoName?: string,
): Promise<SkillInfo[]> {
  const skillNames = await findSkillDirs(skillsDir);
  if (skillNames.length === 0) return [];

  const results = await Promise.all(
    skillNames.map(async (skillName) => {
      const skillPath = path.join(skillsDir, skillName);
      try {
        const content = await fs.promises.readFile(
          path.join(skillPath, "SKILL.md"),
          "utf-8",
        );
        const frontmatter = parseSkillFrontmatter(content);
        return {
          name: frontmatter?.name ?? skillName,
          description: frontmatter?.description ?? "",
          source,
          path: skillPath,
          ...(repoName ? { repoName } : {}),
        } satisfies SkillInfo;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is SkillInfo => r !== null);
}
