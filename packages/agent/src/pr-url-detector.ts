const PR_URL_REGEX = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const GH_PR_CREATE_REGEX = /\bgh\s+pr\s+create\b/;

export interface ExtractCreatedPrUrlInput {
  toolName: string | undefined;
  bashCommand: string | undefined;
  toolResponse: unknown;
  content?: Array<{ type?: string; text?: string }>;
}

export function extractCreatedPrUrl(
  input: ExtractCreatedPrUrlInput,
): string | null {
  const { toolName, bashCommand, toolResponse, content } = input;

  if (!toolName || !/bash/i.test(toolName)) return null;
  if (!bashCommand || !GH_PR_CREATE_REGEX.test(bashCommand)) return null;

  let textToSearch = "";

  if (toolResponse) {
    if (typeof toolResponse === "string") {
      textToSearch = toolResponse;
    } else if (typeof toolResponse === "object" && toolResponse !== null) {
      const respObj = toolResponse as Record<string, unknown>;
      textToSearch =
        String(respObj.stdout || "") + String(respObj.stderr || "");
      if (!textToSearch && respObj.output) {
        textToSearch = String(respObj.output);
      }
    }
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "text" && item.text) {
        textToSearch += ` ${item.text}`;
      }
    }
  }

  if (!textToSearch) return null;

  const match = textToSearch.match(PR_URL_REGEX);
  return match ? match[0] : null;
}
