import { z } from "zod";

export const channelTaskRecordSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  taskId: z.string(),
  createdAt: z.number(),
});
export type ChannelTaskRecord = z.infer<typeof channelTaskRecordSchema>;

export const channelTaskFileMetaSchema = z.object({
  channelId: z.string().optional(),
  taskId: z.string().optional(),
  createdAt: z.number().optional(),
});
export type ChannelTaskFileMeta = z.infer<typeof channelTaskFileMetaSchema>;

export const listChannelTasksInput = z.object({
  channelId: z.string().min(1),
});

export const fileChannelTaskInput = z.object({
  channelId: z.string().min(1),
  taskId: z.string().min(1),
});

export const channelTaskIdInput = z.object({ id: z.string().min(1) });
