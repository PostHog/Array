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
  // Org credit bucket (named ai_credits on the wire): free allocation or
  // billing limit exhausted.
  ai_credits: z.object({ exhausted: z.boolean() }).optional(),
  is_rate_limited: z.boolean(),
  is_pro: z.boolean(),
  // Absent on older gateways — absence means unknown, never "free".
  code_usage_billed: z.boolean().optional(),
  billing_period_end: z.string().datetime().nullable().optional(),
});

export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageOutput = z.infer<typeof usageOutput>;
