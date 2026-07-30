import { z } from "zod";

export const recentEngagementInputSchema = z.object({
  kind: z.enum(["task", "canvas"]),
  id: z.string().min(1),
});
export type RecentEngagementInput = z.infer<typeof recentEngagementInputSchema>;

export const recentItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    id: z.string(),
    title: z.string(),
    engagedAt: z.number(),
  }),
  z.object({
    kind: z.literal("canvas"),
    id: z.string(),
    channelId: z.string(),
    title: z.string(),
    templateId: z.string(),
    engagedAt: z.number(),
  }),
]);
export type RecentItem = z.infer<typeof recentItemSchema>;
