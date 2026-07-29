import { z } from "zod";

const CONTEXT_LENGTH = 32;

export const textArtifactAnchorSchema = z.object({
  kind: z.literal("text"),
  quote: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

export const regionArtifactAnchorSchema = z.object({
  kind: z.literal("region"),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export const documentArtifactAnchorSchema = z.object({
  kind: z.literal("document"),
});

export const artifactAnchorSchema = z.discriminatedUnion("kind", [
  textArtifactAnchorSchema,
  regionArtifactAnchorSchema,
  documentArtifactAnchorSchema,
]);

export type TextArtifactAnchor = z.infer<typeof textArtifactAnchorSchema>;
export type RegionArtifactAnchor = z.infer<typeof regionArtifactAnchorSchema>;
export type ArtifactAnchor = z.infer<typeof artifactAnchorSchema>;

export const artifactCommentContextSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  artifactId: z.string(),
  artifactVersion: z.string(),
  anchor: artifactAnchorSchema,
  threadState: z.enum(["resolved", "open"]).optional(),
});

export type ArtifactCommentContext = z.infer<
  typeof artifactCommentContextSchema
>;

export type ResolvedTextAnchor = {
  start: number;
  end: number;
  status: "exact" | "reanchored";
};

export function createTextArtifactAnchor(
  text: string,
  start: number,
  end: number,
): TextArtifactAnchor | null {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const quote = text.slice(safeStart, safeEnd);
  if (!quote.trim()) return null;

  return {
    kind: "text",
    quote,
    prefix: text.slice(Math.max(0, safeStart - CONTEXT_LENGTH), safeStart),
    suffix: text.slice(safeEnd, safeEnd + CONTEXT_LENGTH),
    start: safeStart,
    end: safeEnd,
  };
}

function candidateScore(
  text: string,
  start: number,
  anchor: TextArtifactAnchor,
): number {
  const prefix = text.slice(Math.max(0, start - anchor.prefix.length), start);
  const end = start + anchor.quote.length;
  const suffix = text.slice(end, end + anchor.suffix.length);
  let score = 0;
  if (anchor.prefix && prefix === anchor.prefix) score += 2;
  if (anchor.suffix && suffix === anchor.suffix) score += 2;
  return score;
}

/**
 * Resolve a persisted text quote without ever guessing. The stored position is
 * verified first. If content moved, prefix/suffix disambiguate quote matches;
 * ties are deliberately treated as orphaned.
 */
export function resolveTextArtifactAnchor(
  text: string,
  anchor: TextArtifactAnchor,
): ResolvedTextAnchor | null {
  if (text.slice(anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end, status: "exact" };
  }

  const candidates: number[] = [];
  let from = 0;
  while (from <= text.length - anchor.quote.length) {
    const match = text.indexOf(anchor.quote, from);
    if (match < 0) break;
    candidates.push(match);
    from = match + Math.max(anchor.quote.length, 1);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const start = candidates[0];
    return {
      start,
      end: start + anchor.quote.length,
      status: "reanchored",
    };
  }

  const ranked = candidates
    .map((start) => ({ start, score: candidateScore(text, start, anchor) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0].score === 0 || ranked[0].score === ranked[1].score) return null;

  return {
    start: ranked[0].start,
    end: ranked[0].start + anchor.quote.length,
    status: "reanchored",
  };
}
