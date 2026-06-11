import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findSkillDirs } from "../skills/skill-discovery";

const MIRROR_STATE_FILE = ".posthog-mirror.json";

export interface CodexMirrorState {
  version: number;
  /** Skill directory names in ~/.agents/skills that we put there. */
  mirrored: string[];
}

export function getCodexSkillsDir(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

export async function readCodexMirrorState(
  codexDir: string,
): Promise<CodexMirrorState> {
  try {
    const content = await fs.promises.readFile(
      path.join(codexDir, MIRROR_STATE_FILE),
      "utf-8",
    );
    const data = JSON.parse(content) as CodexMirrorState;
    if (!Array.isArray(data.mirrored)) {
      return { version: 1, mirrored: [] };
    }
    return {
      version: 1,
      mirrored: data.mirrored.filter((n) => typeof n === "string"),
    };
  } catch {
    return { version: 1, mirrored: [] };
  }
}

export async function writeCodexMirrorState(
  codexDir: string,
  state: CodexMirrorState,
): Promise<void> {
  await fs.promises.mkdir(codexDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(codexDir, MIRROR_STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf-8",
  );
}

/** Marks a codex skill as ours, so future mirrors may overwrite it. */
export async function addMirroredName(
  codexDir: string,
  name: string,
): Promise<void> {
  const state = await readCodexMirrorState(codexDir);
  if (!state.mirrored.includes(name)) {
    state.mirrored.push(name);
    await writeCodexMirrorState(codexDir, state);
  }
}

/**
 * One-way mirror, ours out: copies every user skill into the Codex skills
 * dir so skills created, edited, or installed in PostHog Code work in Codex
 * sessions too.
 *
 * Safety rule: never overwrite a skill in ~/.agents/skills we didn't put
 * there. Colliding names are skipped — the collision surfaces in the Skills
 * tab as a shadowing warning. Mirrors whose source skill is gone are
 * removed (it's a mirror, not an archive).
 */
export async function mirrorUserSkillsToCodex(
  userSkillsDir: string,
  codexDir: string,
): Promise<void> {
  const state = await readCodexMirrorState(codexDir);
  const previouslyMirrored = new Set(state.mirrored);
  const userNames = await findSkillDirs(userSkillsDir);
  await fs.promises.mkdir(codexDir, { recursive: true });

  const copied = await Promise.all(
    userNames.map(async (name) => {
      const target = path.join(codexDir, name);
      if (fs.existsSync(target) && !previouslyMirrored.has(name)) {
        return null;
      }
      await fs.promises.rm(target, { recursive: true, force: true });
      try {
        // dereference: mirrored skills must be self-contained.
        await fs.promises.cp(path.join(userSkillsDir, name), target, {
          recursive: true,
          dereference: true,
        });
        return name;
      } catch {
        // Skip unreadable skills (e.g. broken symlinks); drop the partial copy.
        await fs.promises.rm(target, { recursive: true, force: true });
        return null;
      }
    }),
  );

  await Promise.all(
    [...previouslyMirrored]
      .filter((name) => !userNames.includes(name))
      .map((name) =>
        fs.promises.rm(path.join(codexDir, name), {
          recursive: true,
          force: true,
        }),
      ),
  );

  await writeCodexMirrorState(codexDir, {
    version: 1,
    mirrored: copied.filter((name): name is string => name !== null),
  });
}
