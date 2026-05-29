export type SkillSource = "bundled" | "user" | "repo" | "marketplace";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  repoName?: string;
}
