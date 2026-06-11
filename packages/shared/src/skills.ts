export type SkillSource = "bundled" | "user" | "repo" | "marketplace";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  repoName?: string;
  /** Whether the skill lives in a directory we own on the user's behalf. */
  editable: boolean;
}

export interface SkillFileEntry {
  /** Path relative to the skill directory, using "/" separators. */
  path: string;
  size: number;
}
