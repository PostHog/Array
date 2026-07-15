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
  // Org posthog_code_credits bucket state (free allocation used up, or the
  // org's billing limit reached). Named ai_credits on the wire for legacy
  // client compatibility; reported for every credit bucket.
  ai_credits: z.object({ exhausted: z.boolean() }).optional(),
  is_rate_limited: z.boolean(),
  // Seat-era plan bit; false for everyone once seats are retired.
  is_pro: z.boolean(),
  // True when the org pays for Code usage (usage-based billing). Absent on
  // gateways that predate the field — treat absence as unknown, not false.
  code_usage_billed: z.boolean().optional(),
  billing_period_end: z.string().datetime().nullable().optional(),
});

export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageOutput = z.infer<typeof usageOutput>;
