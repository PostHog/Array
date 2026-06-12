import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoldersService } from "../folders/folders";
import type { PosthogPluginService } from "../posthog-plugin/posthog-plugin";
import { WatcherService } from "../watcher/service";
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
  return new SkillsService(plugin, folders, new WatcherService());
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

describe("watchSkillDirs", () => {
  it(
    "emits a debounced change event when a watched dir changes",
    { timeout: 15_000 },
    async () => {
      const service = makeService();
      const controller = new AbortController();
      const generator = service.watchSkillDirs(
        [repoSkillsDir],
        controller.signal,
      );

      const firstEvent = generator.next();
      // Give the native watcher a moment to attach before mutating the dir.
      await new Promise((r) => setTimeout(r, 500));
      await createSkill(repoSkillsDir, "watched-skill");

      const result = await Promise.race([
        firstEvent,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("timed out waiting for change event")),
            10_000,
          ),
        ),
      ]);
      expect(result).toEqual({ value: { changed: true }, done: false });

      controller.abort();
      await generator.return(undefined);
    },
  );

  it("finishes immediately with no directories", async () => {
    const generator = makeService().watchSkillDirs([]);
    expect(await generator.next()).toEqual({ value: undefined, done: true });
  });

  it(
    "picks up a skills dir created after the watch starts",
    { timeout: 15_000 },
    async () => {
      const service = makeService();
      const controller = new AbortController();
      const lateDir = path.join(root, "late-repo", ".claude", "skills");
      const generator = service.watchSkillDirs([lateDir], controller.signal);

      const firstEvent = generator.next();
      await new Promise((r) => setTimeout(r, 100));
      await mkdir(lateDir, { recursive: true });

      const result = await Promise.race([
        firstEvent,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("timed out waiting for change event")),
            10_000,
          ),
        ),
      ]);
      expect(result).toEqual({ value: { changed: true }, done: false });

      controller.abort();
      await generator.return(undefined);
    },
  );
});

describe("createSkill", () => {
  it("scaffolds a directory with a parseable SKILL.md", async () => {
    const service = makeService();

    const { path: skillPath } = await service.createSkill({
      scope: "repo",
      repoPath: folderPath,
      name: "new-skill",
    });

    expect(skillPath).toBe(path.join(repoSkillsDir, "new-skill"));
    const skills = await service.listSkills();
    const created = skills.find((s) => s.path === skillPath);
    expect(created).toMatchObject({ name: "new-skill", editable: true });
  });

  it("rejects invalid names", async () => {
    await expect(
      makeService().createSkill({
        scope: "repo",
        repoPath: folderPath,
        name: "../escape",
      }),
    ).rejects.toThrow("Skill names must be");
  });

  it("rejects repo scope for folders that are not open", async () => {
    await expect(
      makeService().createSkill({
        scope: "repo",
        repoPath: path.join(root, "other-repo"),
        name: "new-skill",
      }),
    ).rejects.toThrow("not an open workspace folder");
  });

  it("rejects duplicate names", async () => {
    await createSkill(repoSkillsDir, "alpha");

    await expect(
      makeService().createSkill({
        scope: "repo",
        repoPath: folderPath,
        name: "alpha",
      }),
    ).rejects.toThrow("already exists");
  });
});

describe("write-path guard", () => {
  it.each([
    ["bundled skill", () => path.join(pluginPath, "skills", "bundled-skill")],
    ["arbitrary directory", () => path.join(root, "rogue")],
    [
      "traversal out of a writable root",
      () => path.join(repoSkillsDir, "alpha", "..", ".."),
    ],
  ])("rejects mutations against a %s", async (_label, target) => {
    await createSkill(path.join(pluginPath, "skills"), "bundled-skill");
    await createSkill(repoSkillsDir, "alpha");
    const { mkdir: mk, writeFile: wf } = await import("node:fs/promises");
    await mk(path.join(root, "rogue"), { recursive: true });
    await wf(path.join(root, "rogue", "SKILL.md"), "rogue");
    const service = makeService();

    await expect(
      service.saveSkillFile(target(), "SKILL.md", "x"),
    ).rejects.toThrow("Access denied");
    await expect(service.deleteSkill(target())).rejects.toThrow(
      "Access denied",
    );
  });

  it("rejects file writes that escape the skill directory", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");

    await expect(
      makeService().saveSkillFile(skillPath, "../beta.md", "x"),
    ).rejects.toThrow("path outside skill directory");
  });
});

describe("skill mutations", () => {
  it("round-trips manifest edits through the frontmatter parser", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    const service = makeService();

    await service.saveSkillManifest(skillPath, {
      name: "alpha",
      description: "Use when: testing",
      body: "# Alpha\n\nBody text",
    });

    const skills = await service.listSkills();
    const updated = skills.find((s) => s.path === skillPath);
    expect(updated).toMatchObject({
      name: "alpha",
      description: "Use when: testing",
    });
    const content = await service.readSkillFile(skillPath, "SKILL.md");
    expect(content).toContain("# Alpha");
  });

  it("rejects manifest saves without a name", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");

    await expect(
      makeService().saveSkillManifest(skillPath, {
        name: "  ",
        description: "",
        body: "",
      }),
    ).rejects.toThrow("Skill name is required");
  });

  it("creates, renames, and deletes companion files", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    const service = makeService();

    await service.saveSkillFile(skillPath, "references/guide.md", "guide");
    await service.renameSkillFile(
      skillPath,
      "references/guide.md",
      "references/manual.md",
    );
    let contents = await service.getSkillContents(skillPath);
    expect(contents.files.map((f) => f.path)).toEqual([
      "SKILL.md",
      "references/manual.md",
    ]);

    await service.deleteSkillFile(skillPath, "references/manual.md");
    contents = await service.getSkillContents(skillPath);
    expect(contents.files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });

  it("refuses to delete or rename SKILL.md", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    const service = makeService();

    await expect(
      service.deleteSkillFile(skillPath, "SKILL.md"),
    ).rejects.toThrow("SKILL.md cannot be deleted");
    await expect(
      service.deleteSkillFile(skillPath, "./SKILL.md"),
    ).rejects.toThrow("SKILL.md cannot be deleted");
    await expect(
      service.renameSkillFile(skillPath, "SKILL.md", "OTHER.md"),
    ).rejects.toThrow("SKILL.md cannot be renamed");
  });

  it("deletes a whole skill", async () => {
    const skillPath = await createSkill(repoSkillsDir, "alpha");
    const service = makeService();

    await service.deleteSkill(skillPath);

    const skills = await service.listSkills();
    expect(skills.find((s) => s.path === skillPath)).toBeUndefined();
  });
});
