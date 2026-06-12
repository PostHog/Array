export type SkillSource = "bundled" | "user" | "repo" | "marketplace" | "codex";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  repoName?: string;
  /** Whether the skill lives in a directory we own on the user's behalf. */
  editable: boolean;
  /** Size of SKILL.md in bytes (context-cost signal). */
  skillMdBytes: number;
}

export interface SkillFileEntry {
  /** Path relative to the skill directory, using "/" separators. */
  path: string;
  size: number;
}

export interface ExportedSkillFile {
  /** Path relative to the skill directory, using "/" separators. */
  path: string;
  content: string;
}

/** A skill serialized for transport: team publish and install. */
export interface ExportedSkill {
  name: string;
  description: string;
  body: string;
  files: ExportedSkillFile[];
}

/**
 * Server "skill already exists" messages must include this marker verbatim;
 * the UI keys its overwrite-confirmation flow on it.
 */
export const SKILL_EXISTS_MARKER = "already exists";

/**
 * Strips a leading YAML frontmatter block from a SKILL.md document.
 * CRLF-aware so render (UI) and export (workspace-server) agree on the body.
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
