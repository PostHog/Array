import { z } from "zod";

export const usageBucketSchema = z.object({
  used_percent: z.number(),
  reset_at: z.string().datetime(),
  exceeded: z.boolean(),
});

export const usageOutput = z.object({
  product: z.string(),
  user_id: z.number(),
  sustained: usageBucketSchema,
  burst: usageBucketSchema,
  is_rate_limited: z.boolean(),
  is_pro: z.boolean(),
  billing_period_end: z.string().datetime().nullable().optional(),
});

export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageOutput = z.infer<typeof usageOutput>;
