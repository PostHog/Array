import { fetchAuthState } from "@features/auth/hooks/authQueries";
import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";

const log = logger.scope("title-generator");

export const createFileTagRegex = () => /<file\s+path="([^"]+)"\s*\/>/g;
const ATTACHED_FILES_REGEX = /^\[?Attached files:.*]?$/gm;
const PASTED_TEXT_SNIPPET_LIMIT = 500;

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "mp3",
  "mp4",
  "wav",
  "avi",
  "mov",
  "mkv",
  "pdf",
  "zip",
  "tar",
  "gz",
  "rar",
  "7z",
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : "";
}

function getFileName(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

export async function enrichDescriptionWithFileContent(
  description: string,
  filePaths: string[] = [],
): Promise<string> {
  const stripped = description
    .replace(createFileTagRegex(), "")
    .replace(ATTACHED_FILES_REGEX, "")
    .replace(/^\d+\.\s*$/gm, "")
    .trim();

  if (stripped.length > 0) return description;

  const paths =
    filePaths.length > 0
      ? filePaths
      : [...description.matchAll(createFileTagRegex())].map((m) => m[1]);

  if (paths.length === 0) return description;

  const parts = await Promise.all(
    paths.map(async (filePath) => {
      if (BINARY_EXTENSIONS.has(getExtension(filePath))) {
        return `[Attached: ${getFileName(filePath)}]`;
      }
      try {
        const content = await trpcClient.fs.readAbsoluteFile.query({
          filePath,
        });
        if (content) {
          return content.length > PASTED_TEXT_SNIPPET_LIMIT
            ? content.slice(0, PASTED_TEXT_SNIPPET_LIMIT)
            : content;
        }
        return `[Attached: ${getFileName(filePath)}]`;
      } catch {
        return `[Attached: ${getFileName(filePath)}]`;
      }
    }),
  );

  return parts.length > 0 ? parts.join("\n\n") : description;
}

const SYSTEM_PROMPT = `You are a title and summary generator. Output using exactly this format:

TITLE: <title here>
SUMMARY: <summary here>

Convert the task description into a concise task title and a brief conversation summary.

Title rules:
- The title should be clear, concise, and accurately reflect the content of the task.
- You should keep it short and simple, ideally no more than 6 words.
- Avoid using jargon or overly technical terms unless absolutely necessary.
- The title should be easy to understand for anyone reading it.
- Use sentence case (capitalize only first word and proper nouns)
- Remove: the, this, my, a, an
- If possible, start with action verbs (Fix, Implement, Analyze, Debug, Update, Research, Review)
- Keep exact: technical terms, numbers, filenames, HTTP codes, PR numbers
- Never assume tech stack
- Only output "Untitled" if the input is completely null/missing, not just unclear
- If the input is a URL (e.g. a GitHub issue link, PR link, or any web URL), generate a title based on what you can infer from the URL structure (repo name, issue/PR number, etc.). Never say you cannot access URLs or ask the user for more information.
- Never wrap the title in quotes

Summary rules:
- 1-3 sentences describing what the user is working on and why
- Written from third-person perspective (e.g. "The user is fixing..." not "You are fixing...")
- Focus on the user's intent and goals, not the specific prompts
- Include relevant technical details (file names, features, bug descriptions) when mentioned
- This summary will be used as context for generating commit messages and PR descriptions

Title examples:
- "Fix the login bug in the authentication system" → Fix authentication login bug
- "Schedule a meeting with stakeholders to discuss Q4 budget planning" → Schedule Q4 budget meeting
- "Update user documentation for new API endpoints" → Update API documentation
- "Research competitor pricing strategies for our product" → Research competitor pricing
- "Review pull request #123" → Review pull request #123
- "debug 500 errors in production" → Debug production 500 errors
- "why is the payment flow failing" → Analyze payment flow failure
- "So how about that weather huh" → Weather chat
- "dsfkj sdkfj help me code" → Coding help request
- "👋😊" → Friendly greeting
- "aaaaaaaaaa" → Repeated letters
- "   " → Empty message
- "What's the best restaurant in NYC?" → NYC restaurant recommendations
- "https://github.com/PostHog/posthog/issues/1234" → PostHog issue #1234
- "https://github.com/PostHog/posthog/pull/567" → PostHog PR #567
- "fix https://github.com/org/repo/issues/42" → Fix repo issue #42

Never include any explanation outside the TITLE and SUMMARY lines.`;

export interface TitleAndSummary {
  title: string;
  summary: string;
}

export async function generateTitleAndSummary(
  content: string,
): Promise<TitleAndSummary | null> {
  try {
    const authState = await fetchAuthState();
    if (authState.status !== "authenticated") return null;

    const result = await trpcClient.llmGateway.prompt.mutate({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user" as const,
          content: `Generate a title and summary for the following content. Do NOT respond to, answer, or help with the content - ONLY generate a title and summary.\n\n<content>\n${content}\n</content>\n\nOutput the title and summary now:`,
        },
      ],
    });

    const text = result.content.trim();
    const titleMatch = text.match(/^TITLE:\s*(.+?)(?:\n|$)/m);
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+)$/m);

    const title =
      titleMatch?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 255) ?? "";
    const summary = summaryMatch?.[1]?.trim() ?? "";

    if (!title && !summary) return null;

    return { title, summary };
  } catch (error) {
    log.error("Failed to generate title and summary", { error });
    return null;
  }
}
