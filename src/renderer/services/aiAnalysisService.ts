import { createOpenAI } from "@ai-sdk/openai";
import type { ExtractedTask } from "@renderer/stores/activeRecordingStore";
import { generateObject } from "ai";
import { z } from "zod";

const SUMMARY_PROMPT = `Create a very brief (3-7 words) title that summarizes what this conversation is about.

Transcript:`;

const TASK_EXTRACTION_PROMPT = `Analyze the following conversation transcript and extract any actionable tasks, feature requests, bug fixes, or work items that were discussed or requested. This includes:
- Explicit action items ("we need to...", "let's build...")
- Feature requests ("I want...", "please build...")
- Bug reports ("this is broken...", "fix the...")
- Requirements ("it should have...", "make it...")

For each task, provide a clear title and a description with relevant context from the conversation.

If there are no actionable tasks, return an empty tasks array.

Transcript:`;

export async function generateTranscriptSummary(
  transcriptText: string,
  openaiApiKey: string,
): Promise<string | null> {
  try {
    const openai = createOpenAI({ apiKey: openaiApiKey });

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: z.object({
        title: z.string().describe("A brief 3-7 word summary title"),
      }),
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates concise titles for conversation transcripts. The title should be 3-7 words and capture the main topic.",
        },
        {
          role: "user",
          content: `${SUMMARY_PROMPT}\n${transcriptText}`,
        },
      ],
    });

    return object.title || null;
  } catch (error) {
    console.error("[AI Analysis] Failed to generate summary:", error);
    throw error;
  }
}

export async function extractTasksFromTranscript(
  transcriptText: string,
  openaiApiKey: string,
): Promise<ExtractedTask[]> {
  try {
    const openai = createOpenAI({ apiKey: openaiApiKey });

    const schema = z.object({
      tasks: z.array(
        z.object({
          title: z.string().describe("Brief task title"),
          description: z.string().describe("Detailed description with context"),
        }),
      ),
    });

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts actionable tasks from conversation transcripts. Be generous in identifying work items - include feature requests, requirements, and any work that needs to be done.",
        },
        {
          role: "user",
          content: `${TASK_EXTRACTION_PROMPT}\n${transcriptText}`,
        },
      ],
    });

    return object.tasks || [];
  } catch (error) {
    console.error("[AI Analysis] Failed to extract tasks:", error);
    throw error;
  }
}
