import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMirroredName,
  mirrorUserSkillsToCodex,
  readCodexMirrorState,
} from "./codex-mirror";

let root: string;
let userDir: string;
let codexDir: string;

async function createSkill(dir: string, name: string, body = `# ${name}`) {
  await mkdir(path.join(dir, name), { recursive: true });
  await writeFile(path.join(dir, name, "SKILL.md"), body);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "codex-mirror-test-"));
  userDir = path.join(root, "user-skills");
  codexDir = path.join(root, "codex-skills");
  await mkdir(userDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("mirrorUserSkillsToCodex", () => {
  it("copies user skills into the codex dir and records them", async () => {
    await createSkill(userDir, "alpha");
    await createSkill(userDir, "beta");

    await mirrorUserSkillsToCodex(userDir, codexDir);

    expect(
      await readFile(path.join(codexDir, "alpha", "SKILL.md"), "utf-8"),
    ).toBe("# alpha");
    expect(existsSync(path.join(codexDir, "beta", "SKILL.md"))).toBe(true);
    const state = await readCodexMirrorState(codexDir);
    expect(state.mirrored.sort()).toEqual(["alpha", "beta"]);
  });

  it("never overwrites a codex skill we did not put there", async () => {
    await mkdir(codexDir, { recursive: true });
    await createSkill(codexDir, "alpha", "codex original");
    await createSkill(userDir, "alpha", "user version");

    await mirrorUserSkillsToCodex(userDir, codexDir);

    expect(
      await readFile(path.join(codexDir, "alpha", "SKILL.md"), "utf-8"),
    ).toBe("codex original");
    const state = await readCodexMirrorState(codexDir);
    expect(state.mirrored).toEqual([]);
  });

  it("overwrites skills we previously mirrored and carries edits out", async () => {
    await createSkill(userDir, "alpha", "v1");
    await mirrorUserSkillsToCodex(userDir, codexDir);

    await writeFile(path.join(userDir, "alpha", "SKILL.md"), "v2");
    await mirrorUserSkillsToCodex(userDir, codexDir);

    expect(
      await readFile(path.join(codexDir, "alpha", "SKILL.md"), "utf-8"),
    ).toBe("v2");
  });

  it("removes mirrors whose source skill is gone", async () => {
    await createSkill(userDir, "alpha");
    await mirrorUserSkillsToCodex(userDir, codexDir);

    await rm(path.join(userDir, "alpha"), { recursive: true });
    await mirrorUserSkillsToCodex(userDir, codexDir);

    expect(existsSync(path.join(codexDir, "alpha"))).toBe(false);
    expect((await readCodexMirrorState(codexDir)).mirrored).toEqual([]);
  });

  it("takes ownership of an imported skill via addMirroredName", async () => {
    // Codex-authored skill, imported to user skills (import records the name).
    await mkdir(codexDir, { recursive: true });
    await createSkill(codexDir, "alpha", "codex original");
    await createSkill(userDir, "alpha", "imported then edited");
    await addMirroredName(codexDir, "alpha");

    await mirrorUserSkillsToCodex(userDir, codexDir);

    expect(
      await readFile(path.join(codexDir, "alpha", "SKILL.md"), "utf-8"),
    ).toBe("imported then edited");
  });
});

describe("readCodexMirrorState", () => {
  it("returns an empty state for a missing or corrupt file", async () => {
    expect(await readCodexMirrorState(codexDir)).toEqual({
      version: 1,
      mirrored: [],
    });

    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, ".posthog-mirror.json"), "not json");
    expect(await readCodexMirrorState(codexDir)).toEqual({
      version: 1,
      mirrored: [],
    });
  });
});
