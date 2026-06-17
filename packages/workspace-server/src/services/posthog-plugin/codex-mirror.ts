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

/**
 * Opt-out for the Codex skills mirror. Set `POSTHOG_DISABLE_CODEX_MIRROR=1`
 * when you don't use Codex (or another tool that reads ~/.agents/skills) and
 * don't want PostHog Code writing there on startup. Read at call time so it
 * can be toggled without a rebuild.
 */
export function isCodexMirrorDisabled(): boolean {
  return process.env.POSTHOG_DISABLE_CODEX_MIRROR === "1";
}

/**
 * Copies a skill directory into Codex's skills dir, but instead of deep-copying
 * its top-level `node_modules` (which can be hundreds of MB of deps, e.g. ML
 * runtimes) it symlinks `node_modules` to the source. Node resolves
 * dependencies through the symlink, so the mirrored skill stays runnable, while
 * we avoid duplicating the heavy tree on every mirror (no transient disk peak,
 * no per-startup I/O churn). The caller is responsible for removing `dest`
 * first when overwriting.
 */
export async function copySkillDirLinkingNodeModules(
  src: string,
  dest: string,
  options: { dereference?: boolean } = {},
): Promise<void> {
  const srcNodeModules = path.join(src, "node_modules");
  await fs.promises.cp(src, dest, {
    recursive: true,
    dereference: options.dereference ?? false,
    // Skip only the skill's top-level node_modules; everything else copies.
    filter: (source) => source !== srcNodeModules,
  });
  if (fs.existsSync(srcNodeModules)) {
    const destNodeModules = path.join(dest, "node_modules");
    // The cp filter never writes node_modules and callers remove `dest`
    // first, so the target is absent here.
    try {
      // "junction" so this also works on Windows without elevated permissions;
      // the type arg is ignored on POSIX. Target is absolute, as junctions require.
      await fs.promises.symlink(srcNodeModules, destNodeModules, "junction");
    } catch {
      // Some filesystems / sandbox policies reject symlinks. Fall back to a
      // real copy so the mirrored skill keeps its dependencies (the pre-change
      // behavior in those environments) rather than ending up dep-less.
      await fs.promises.rm(destNodeModules, { recursive: true, force: true });
      await fs.promises.cp(srcNodeModules, destNodeModules, {
        recursive: true,
        dereference: true,
      });
    }
  }
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
  if (isCodexMirrorDisabled()) {
    return;
  }
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
        // dereference: mirrored skills must be self-contained — except
        // node_modules, which is symlinked rather than duplicated.
        await copySkillDirLinkingNodeModules(
          path.join(userSkillsDir, name),
          target,
          { dereference: true },
        );
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
