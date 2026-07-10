import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { ...fs, default: fs };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

vi.mock("node:os", () => ({
  homedir: () => "/mock/home",
  tmpdir: () => "/mock/tmp",
  default: { homedir: () => "/mock/home", tmpdir: () => "/mock/tmp" },
}));

import { discoverExternalPlugins } from "./discover-plugins";

const USER_DATA_DIR = "/mock/userData";
const USER_SKILLS_DIR = "/mock/home/.claude/skills";
const INSTALLED_PLUGINS_PATH =
  "/mock/home/.claude/plugins/installed_plugins.json";

function createSkillDir(basePath: string, skillName: string) {
  const skillPath = `${basePath}/${skillName}`;
  vol.mkdirSync(skillPath, { recursive: true });
  vol.writeFileSync(`${skillPath}/SKILL.md`, `# ${skillName}`);
}

describe("discoverExternalPlugins", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no skills or plugins exist", async () => {
    const result = await discoverExternalPlugins({
      userDataDir: USER_DATA_DIR,
    });
    expect(result).toEqual([]);
  });

  describe("marketplace plugins", () => {
    it("discovers installed marketplace plugins", async () => {
      const installPath = "/mock/plugins/my-plugin";
      vol.mkdirSync(installPath, { recursive: true });

      const installedPlugins = {
        version: 1,
        plugins: {
          "my-plugin": [{ scope: "global", installPath, version: "1.0.0" }],
        },
      };

      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(
        INSTALLED_PLUGINS_PATH,
        JSON.stringify(installedPlugins),
      );

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([{ type: "local", path: installPath }]);
    });

    it("skips plugins whose installPath does not exist", async () => {
      const installedPlugins = {
        version: 1,
        plugins: {
          "missing-plugin": [
            {
              scope: "global",
              installPath: "/nonexistent/path",
              version: "1.0.0",
            },
          ],
        },
      };

      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(
        INSTALLED_PLUGINS_PATH,
        JSON.stringify(installedPlugins),
      );

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([]);
    });

    it("returns empty when installed_plugins.json is missing", async () => {
      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([]);
    });

    it("returns empty when installed_plugins.json has invalid JSON", async () => {
      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(INSTALLED_PLUGINS_PATH, "not json at all");

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([]);
    });

    it("returns empty when plugins field is missing", async () => {
      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(INSTALLED_PLUGINS_PATH, JSON.stringify({ version: 1 }));

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([]);
    });

    it("skips non-array plugin entries", async () => {
      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(
        INSTALLED_PLUGINS_PATH,
        JSON.stringify({
          version: 1,
          plugins: { "bad-entry": "not-an-array" },
        }),
      );

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([]);
    });

    it("excludes the posthog marketplace plugin (bundled in-app)", async () => {
      const posthogPath = "/mock/plugins/posthog";
      const otherPath = "/mock/plugins/other";
      vol.mkdirSync(posthogPath, { recursive: true });
      vol.mkdirSync(otherPath, { recursive: true });

      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(
        INSTALLED_PLUGINS_PATH,
        JSON.stringify({
          version: 2,
          plugins: {
            "posthog@claude-plugins-official": [
              { scope: "user", installPath: posthogPath, version: "1.0.0" },
            ],
            "other@claude-plugins-official": [
              { scope: "user", installPath: otherPath, version: "1.0.0" },
            ],
          },
        }),
      );

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([{ type: "local", path: otherPath }]);
    });

    it("handles multiple plugins with multiple entries", async () => {
      const pathA = "/mock/plugins/plugin-a";
      const pathB = "/mock/plugins/plugin-b";
      vol.mkdirSync(pathA, { recursive: true });
      vol.mkdirSync(pathB, { recursive: true });

      const installedPlugins = {
        version: 1,
        plugins: {
          "plugin-a": [
            { scope: "global", installPath: pathA, version: "1.0.0" },
          ],
          "plugin-b": [
            { scope: "global", installPath: pathB, version: "2.0.0" },
          ],
        },
      };

      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(
        INSTALLED_PLUGINS_PATH,
        JSON.stringify(installedPlugins),
      );

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ type: "local", path: pathA });
      expect(result).toContainEqual({ type: "local", path: pathB });
    });
  });

  describe("combined sources", () => {
    it("merges marketplace and codex skills together", async () => {
      // Marketplace plugin
      const marketplacePath = "/mock/plugins/marketplace-plugin";
      vol.mkdirSync(marketplacePath, { recursive: true });
      vol.mkdirSync("/mock/home/.claude/plugins", { recursive: true });
      vol.writeFileSync(
        INSTALLED_PLUGINS_PATH,
        JSON.stringify({
          version: 1,
          plugins: {
            mp: [
              {
                scope: "global",
                installPath: marketplacePath,
                version: "1.0.0",
              },
            ],
          },
        }),
      );

      // Codex skills
      createSkillDir("/mock/home/.agents/skills", "codex-skill");

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: "local",
        path: marketplacePath,
      });
      expect(result[1]).toEqual({
        type: "local",
        path: `${USER_DATA_DIR}/plugins/codex-skills`,
      });
    });
  });

  describe("codex skills", () => {
    const CODEX_SKILLS_DIR = "/mock/home/.agents/skills";

    it("discovers the user's codex skills as a synthetic plugin", async () => {
      createSkillDir(CODEX_SKILLS_DIR, "codex-skill");

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result).toEqual([
        { type: "local", path: `${USER_DATA_DIR}/plugins/codex-skills` },
      ]);
      const pluginJson = JSON.parse(
        vol.readFileSync(
          `${USER_DATA_DIR}/plugins/codex-skills/plugin.json`,
          "utf-8",
        ) as string,
      );
      expect(pluginJson.description).toBe("User Codex skills");
    });

    it("excludes codex skills whose name matches a user skill", async () => {
      createSkillDir(USER_SKILLS_DIR, "shared");
      createSkillDir(CODEX_SKILLS_DIR, "shared");
      createSkillDir(CODEX_SKILLS_DIR, "codex-only");

      await discoverExternalPlugins({ userDataDir: USER_DATA_DIR });

      const entries = vol.readdirSync(
        `${USER_DATA_DIR}/plugins/codex-skills/skills`,
      );
      expect(entries).toEqual(["codex-only"]);
    });

    it("excludes codex skills whose name matches a bundled skill", async () => {
      const bundledSkillsDir = "/mock/bundled/skills";
      createSkillDir(bundledSkillsDir, "query-data");
      createSkillDir(CODEX_SKILLS_DIR, "query-data");
      createSkillDir(CODEX_SKILLS_DIR, "codex-only");

      await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
        bundledSkillsDir,
      });

      const entries = vol.readdirSync(
        `${USER_DATA_DIR}/plugins/codex-skills/skills`,
      );
      expect(entries).toEqual(["codex-only"]);
    });

    it("omits the codex plugin entirely when every name collides", async () => {
      createSkillDir(USER_SKILLS_DIR, "dup");
      createSkillDir(CODEX_SKILLS_DIR, "dup");

      const result = await discoverExternalPlugins({
        userDataDir: USER_DATA_DIR,
      });

      expect(result.some((p) => p.path.endsWith("/codex-skills"))).toBe(false);
    });
  });
});
