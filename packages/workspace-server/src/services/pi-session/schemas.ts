import { z } from "zod";

export const startPiSessionInput = z.object({
  taskId: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
});

export const piSessionStartOutput = z.object({
  sessionFile: z.string().nullable(),
  sessionId: z.string(),
});

export const resumePiSessionInput = z.object({
  taskId: z.string(),
  cwd: z.string(),
});

export const piSessionPromptInput = z.object({
  taskId: z.string(),
  prompt: z.string().min(1),
});

export const piSessionTranscriptInput = z.object({ taskId: z.string() });

export const piSessionEntriesInput = piSessionTranscriptInput.extend({
  since: z.string().optional(),
});

export type StartPiSessionInput = z.infer<typeof startPiSessionInput>;
export type PiSessionPromptInput = z.infer<typeof piSessionPromptInput>;
