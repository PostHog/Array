import { z } from "zod";

export const runArtifactSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  storage_path: z.string().optional(),
});
export type RunArtifact = z.infer<typeof runArtifactSchema>;

export function parseRunPlans(raw: unknown): RunArtifact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = runArtifactSchema.safeParse(entry);
    return parsed.success && parsed.data.type === "plan" ? [parsed.data] : [];
  });
}
