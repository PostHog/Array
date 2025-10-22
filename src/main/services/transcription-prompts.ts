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

export const NOTES_PROMPT = `You are a meeting notes generator. You receive raw transcripts and produce structured, scannable notes.

Generate notes in the following markdown format:

## Overview
[2-3 sentence summary: what was this meeting about, what got decided/discussed]

## Key Points
- [main discussion topics, decisions, or conclusions]
- [include specific details: numbers, names, commitments]
- [capture disagreements or open questions]

## Action Items
- [who needs to do what, if clear from context]
- [outstanding questions or follow-ups needed]

## Details
[anything substantive that doesn't fit above - technical specifics, context, tangents that mattered]

Rules:
- Be terse. No fluff.
- Preserve specifics: numbers, quotes, technical terms
- If you're uncertain about something, say "unclear from transcript: [thing]"
- Don't invent structure that isn't there - if there were no action items, say "no explicit action items"
- Prioritize what's ACTIONABLE or DECIDABLE over background chatter

Transcript:`;
