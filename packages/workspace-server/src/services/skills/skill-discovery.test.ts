import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSkillDirs, readSkillMetadataFromDir } from "./skill-discovery";

let root: string;

async function createSkill(
  skillsDir: string,
  name: string,
  frontmatter?: string,
) {
  const skillPath = path.join(skillsDir, name);
  await mkdir(skillPath, { recursive: true });
  await writeFile(path.join(skillPath, "SKILL.md"), frontmatter ?? `# ${name}`);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "skills-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("findSkillDirs", () => {
  it("returns empty for a missing directory", async () => {
    expect(await findSkillDirs(path.join(root, "nope"))).toEqual([]);
  });

  it("lists only directories containing SKILL.md", async () => {
    const skillsDir = path.join(root, "skills");
    await createSkill(skillsDir, "alpha");
    await mkdir(path.join(skillsDir, "not-a-skill"), { recursive: true });
    await writeFile(path.join(skillsDir, "not-a-skill", "README.md"), "nope");
    await writeFile(path.join(skillsDir, "loose-file.txt"), "hello");

    expect(await findSkillDirs(skillsDir)).toEqual(["alpha"]);
  });
});

describe("readSkillMetadataFromDir", () => {
  it("returns empty when no skills exist", async () => {
    expect(
      await readSkillMetadataFromDir(path.join(root, "skills"), "user"),
    ).toEqual([]);
  });

  it("parses frontmatter name/description and tags the source", async () => {
    const skillsDir = path.join(root, "skills");
    await createSkill(
      skillsDir,
      "my-skill",
      "---\nname: Pretty Name\ndescription: Does a thing\n---\nbody",
    );

    const result = await readSkillMetadataFromDir(skillsDir, "repo", "my-repo");

    expect(result).toEqual([
      {
        name: "Pretty Name",
        description: "Does a thing",
        source: "repo",
        path: path.join(skillsDir, "my-skill"),
        repoName: "my-repo",
      },
    ]);
  });

  it("falls back to the directory name when frontmatter is absent", async () => {
    const skillsDir = path.join(root, "skills");
    await createSkill(skillsDir, "bare-skill", "no frontmatter here");

    const result = await readSkillMetadataFromDir(skillsDir, "user");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "bare-skill",
      description: "",
      source: "user",
    });
    expect(result[0]).not.toHaveProperty("repoName");
  });
});
