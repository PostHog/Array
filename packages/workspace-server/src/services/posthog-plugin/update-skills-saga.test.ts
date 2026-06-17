import { existsSync, lstatSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withEnvVar } from "./test-helpers";
import { syncCodexSkills } from "./update-skills-saga";

let root: string;
let pluginPath: string;
let codexDir: string;

async function createBundledSkill(name: string, body = `# ${name}`) {
  const dir = path.join(pluginPath, "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), body);
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sync-codex-test-"));
  pluginPath = path.join(root, "plugin");
  codexDir = path.join(root, "codex-skills");
  await mkdir(pluginPath, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("syncCodexSkills", () => {
  it("copies bundled skills and symlinks node_modules", async () => {
    const skillDir = await createBundledSkill("alpha");
    await mkdir(path.join(skillDir, "node_modules", "dep"), {
      recursive: true,
    });
    await writeFile(
      path.join(skillDir, "node_modules", "dep", "index.js"),
      "module.exports = 7;",
    );

    await syncCodexSkills(pluginPath, codexDir);

    expect(
      await readFile(path.join(codexDir, "alpha", "SKILL.md"), "utf-8"),
    ).toBe("# alpha");
    const mirroredNodeModules = path.join(codexDir, "alpha", "node_modules");
    expect(lstatSync(mirroredNodeModules).isSymbolicLink()).toBe(true);
    expect(await realpath(mirroredNodeModules)).toBe(
      await realpath(path.join(skillDir, "node_modules")),
    );
  });

  it("does nothing when POSTHOG_DISABLE_CODEX_MIRROR=1", async () => {
    await createBundledSkill("alpha");
    await withEnvVar("POSTHOG_DISABLE_CODEX_MIRROR", "1", async () => {
      await syncCodexSkills(pluginPath, codexDir);
    });

    expect(existsSync(path.join(codexDir, "alpha"))).toBe(false);
  });
});
