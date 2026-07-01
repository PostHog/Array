import { z } from "zod";

export const autoresearchDirectionSchema = z.enum(["maximize", "minimize"]);
export type AutoresearchDirection = z.infer<typeof autoresearchDirectionSchema>;

export const autoresearchRunStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  "stopped",
  "failed",
]);
export type AutoresearchRunStatus = z.infer<typeof autoresearchRunStatusSchema>;

export const autoresearchEndReasonSchema = z.enum([
  "target-reached",
  "max-iterations",
  "stopped-by-user",
  "missing-report",
  "session-error",
  "send-failed",
]);
export type AutoresearchEndReason = z.infer<typeof autoresearchEndReasonSchema>;

export const AUTORESEARCH_MAX_ITERATIONS_LIMIT = 200;

export const autoresearchConfigSchema = z.object({
  taskId: z.string().min(1),
  /** Human name of the metric being optimized, e.g. "bundle size (kB)". */
  metricName: z.string().trim().min(1),
  direction: autoresearchDirectionSchema,
  /** Optional value at which the run auto-completes. */
  targetValue: z.number().finite().nullable().default(null),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(AUTORESEARCH_MAX_ITERATIONS_LIMIT)
    .default(10),
  /**
   * Free-form instructions for the agent: what to optimize, how to measure
   * the metric, and any constraints to respect.
   */
  instructions: z.string().trim().min(1),
});
export type AutoresearchConfig = z.infer<typeof autoresearchConfigSchema>;
export type AutoresearchConfigInput = z.input<typeof autoresearchConfigSchema>;

export const autoresearchIterationSchema = z.object({
  /** 1-based iteration number. */
  index: z.number().int().min(1),
  /** Metric value the agent reported for this iteration. */
  value: z.number().finite(),
  /** Best value observed up to and including this iteration. */
  bestValue: z.number().finite(),
  /** Change from the previous iteration's value; null for the first. */
  delta: z.number().finite().nullable(),
  /** Agent's one-line description of what it changed. */
  summary: z.string().nullable(),
  at: z.number(),
});
export type AutoresearchIteration = z.infer<typeof autoresearchIterationSchema>;

export const autoresearchRunSchema = z.object({
  id: z.string().min(1),
  config: autoresearchConfigSchema,
  status: autoresearchRunStatusSchema,
  iterations: z.array(autoresearchIterationSchema),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  endReason: autoresearchEndReasonSchema.nullable(),
  lastError: z.string().nullable(),
});
export type AutoresearchRun = z.infer<typeof autoresearchRunSchema>;

/** A metric report parsed from the agent's reply. */
export interface AutoresearchReport {
  value: number;
  summary: string | null;
}
