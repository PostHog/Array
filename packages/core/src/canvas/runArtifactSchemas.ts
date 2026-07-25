import { z } from "zod";

/**
 * An entry in a run's untyped `artifacts` blob. Every field is optional because
 * the payload is whatever the backend attached; only `type` is load-bearing.
 */
export const runArtifactSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  storage_path: z.string().optional(),
});
export type RunArtifact = z.infer<typeof runArtifactSchema>;

/**
 * The plan artifacts on a run. Entries that don't parse are dropped rather than
 * throwing — one malformed artifact shouldn't take the whole panel down — and a
 * non-array blob reads as "no artifacts".
 */
export function parseRunPlans(raw: unknown): RunArtifact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = runArtifactSchema.safeParse(entry);
    return parsed.success && parsed.data.type === "plan" ? [parsed.data] : [];
  });
}
