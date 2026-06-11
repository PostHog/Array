import { z } from "zod";

export const skillSource = z.enum(["bundled", "user", "repo", "marketplace"]);

export const skillInfo = z.object({
  name: z.string(),
  description: z.string(),
  source: skillSource,
  path: z.string(),
  repoName: z.string().optional(),
  editable: z.boolean(),
});

export const listSkillsOutput = z.array(skillInfo);

export const skillFileEntry = z.object({
  // Path relative to the skill directory, using "/" separators.
  path: z.string(),
  size: z.number(),
});

export const skillContentsInput = z.object({
  skillPath: z.string(),
});

export const skillContentsOutput = z.object({
  files: z.array(skillFileEntry),
});

export const readSkillFileInput = z.object({
  skillPath: z.string(),
  filePath: z.string(),
});

export const readSkillFileOutput = z.string().nullable();

export type SkillInfo = z.infer<typeof skillInfo>;
export type SkillSource = z.infer<typeof skillSource>;
export type SkillFileEntry = z.infer<typeof skillFileEntry>;
export type SkillContents = z.infer<typeof skillContentsOutput>;
