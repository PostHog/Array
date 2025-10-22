/**
 * Transcription and AI processing prompts
 *
 * These prompts are used for:
 * - Generating concise summaries of transcribed audio
 * - Extracting actionable tasks from conversations
 *
 * Future: Move to user-editable config file (~/.array/prompts.json)
 */

export const SUMMARY_PROMPT = `Create a very brief (3-7 words) title that summarizes what this conversation is about.

Transcript:`;

export const TASK_EXTRACTION_PROMPT = `Analyze the following conversation transcript and extract any actionable tasks, feature requests, bug fixes, or work items that were discussed or requested. This includes:
- Explicit action items ("we need to...", "let's build...")
- Feature requests ("I want...", "please build...")
- Bug reports ("this is broken...", "fix the...")
- Requirements ("it should have...", "make it...")

For each task, provide a clear title and a description with relevant context from the conversation.

If there are no actionable tasks, return an empty tasks array.

Transcript:`;
