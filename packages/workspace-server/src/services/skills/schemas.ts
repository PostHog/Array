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

export const skillScope = z.enum(["user", "repo"]);

export const createSkillInput = z.object({
  scope: skillScope,
  repoPath: z.string().optional(),
  name: z.string(),
});

export const skillPathOutput = z.object({
  path: z.string(),
});

export const saveSkillManifestInput = z.object({
  skillPath: z.string(),
  name: z.string(),
  description: z.string(),
  body: z.string(),
});

export const saveSkillFileInput = z.object({
  skillPath: z.string(),
  filePath: z.string(),
  content: z.string(),
});

export const renameSkillFileInput = z.object({
  skillPath: z.string(),
  fromPath: z.string(),
  toPath: z.string(),
});

export const deleteSkillFileInput = z.object({
  skillPath: z.string(),
  filePath: z.string(),
});

export const deleteSkillInput = z.object({
  skillPath: z.string(),
});

export type SkillInfo = z.infer<typeof skillInfo>;
export type SkillScope = z.infer<typeof skillScope>;
export type CreateSkillInput = z.infer<typeof createSkillInput>;
export type SkillSource = z.infer<typeof skillSource>;
export type SkillFileEntry = z.infer<typeof skillFileEntry>;
export type SkillContents = z.infer<typeof skillContentsOutput>;
