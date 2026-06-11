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
