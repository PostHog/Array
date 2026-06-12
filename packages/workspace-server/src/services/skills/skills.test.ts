import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoldersService } from "../folders/folders";
import type { PosthogPluginService } from "../posthog-plugin/posthog-plugin";
import { SkillsService } from "./skills";

let root: string;
let pluginPath: string;
let folderPath: string;
let repoSkillsDir: string;

function makeService(): SkillsService {
  const plugin = {
    getPluginPath: () => pluginPath,
  } as unknown as PosthogPluginService;
  const folders = {
    getFolders: async () => [{ path: folderPath, name: "my-repo" }],
  } as unknown as FoldersService;
  return new SkillsService(plugin, folders);
}

async function createSkill(
  skillsDir: string,
  name: string,
  content = `---\nname: ${name}\ndescription: about ${name}\n---\nbody`,
): Promise<string> {
  const skillPath = path.join(skillsDir, name);
  await mkdir(skillPath, { recursive: true });
  await writeFile(path.join(skillPath, "SKILL.md"), content);
  return skillPath;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "skills-service-test-"));
  pluginPath = path.join(root, "plugin");
  folderPath = path.join(root, "repo");
  repoSkillsDir = path.join(folderPath, ".claude", "skills");
  await mkdir(path.join(pluginPath, "skills"), { recursive: true });
  await mkdir(repoSkillsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listSkills", () => {
  it("marks repo skills editable and bundled skills read-only", async () => {
    await createSkill(repoSkillsDir, "repo-skill");
    await createSkill(path.join(pluginPath, "skills"), "bundled-skill");

    const skills = await makeService().listSkills();

    const repoSkill = skills.find((s) => s.name === "repo-skill");
    const bundledSkill = skills.find((s) => s.name === "bundled-skill");
    expect(repoSkill?.editable).toBe(true);
    expect(bundledSkill?.editable).toBe(false);
  });
});

describe("getSkillContents", () => {
  it("lists every file in the skill directory with relative paths", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    await mkdir(path.join(skillPath, "references"), { recursive: true });
    await writeFile(path.join(skillPath, "references", "guide.md"), "guide");
    await mkdir(path.join(skillPath, "scripts"), { recursive: true });
    await writeFile(path.join(skillPath, "scripts", "run.sh"), "echo hi");

    const contents = await makeService().getSkillContents(skillPath);

    expect(contents.files.map((f) => f.path)).toEqual([
      "SKILL.md",
      "references/guide.md",
      "scripts/run.sh",
    ]);
    for (const file of contents.files) {
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it("rejects directories outside the discovery roots", async () => {
    const rogue = path.join(root, "rogue-skill");
    await mkdir(rogue, { recursive: true });
    await writeFile(path.join(rogue, "SKILL.md"), "rogue");

    await expect(makeService().getSkillContents(rogue)).rejects.toThrow(
      "not a known skill directory",
    );
  });

  it("rejects path traversal in the skill path", async () => {
    await createSkill(repoSkillsDir, "alpha");

    await expect(
      makeService().getSkillContents(
        path.join(repoSkillsDir, "alpha", "..", "..", "..", ".."),
      ),
    ).rejects.toThrow("not a known skill directory");
  });
});

describe("readSkillFile", () => {
  it("reads a nested file inside the skill directory", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    await mkdir(path.join(skillPath, "references"), { recursive: true });
    await writeFile(path.join(skillPath, "references", "guide.md"), "guide!");

    const content = await makeService().readSkillFile(
      skillPath,
      "references/guide.md",
    );

    expect(content).toBe("guide!");
  });

  it("rejects ../ traversal out of the skill directory", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    await createSkill(repoSkillsDir, "beta", "secret");

    await expect(
      makeService().readSkillFile(skillPath, "../beta/SKILL.md"),
    ).rejects.toThrow("path outside skill directory");
  });

  it("rejects absolute file paths", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");

    await expect(
      makeService().readSkillFile(skillPath, "/etc/passwd"),
    ).rejects.toThrow("path outside skill directory");
  });

  it("rejects an empty relative path", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");

    await expect(makeService().readSkillFile(skillPath, "")).rejects.toThrow(
      "path outside skill directory",
    );
  });

  it("returns null for missing files", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");

    expect(await makeService().readSkillFile(skillPath, "nope.md")).toBeNull();
  });

  it("returns null for symlinks escaping the skill directory", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    const secret = path.join(root, "secret.txt");
    await writeFile(secret, "top secret");
    await symlink(secret, path.join(skillPath, "leak.md"));

    expect(await makeService().readSkillFile(skillPath, "leak.md")).toBeNull();
  });

  it("returns null for files reached through a symlinked directory", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    const outside = path.join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.txt"), "top secret");
    await symlink(outside, path.join(skillPath, "evil"));

    expect(
      await makeService().readSkillFile(skillPath, "evil/secret.txt"),
    ).toBeNull();
  });

  it("reads symlinks that stay inside the skill directory", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    await writeFile(path.join(skillPath, "real.md"), "real content");
    await symlink(
      path.join(skillPath, "real.md"),
      path.join(skillPath, "alias.md"),
    );

    expect(await makeService().readSkillFile(skillPath, "alias.md")).toBe(
      "real content",
    );
  });
});
