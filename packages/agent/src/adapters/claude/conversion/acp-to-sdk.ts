import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptRequest } from "@agentclientprotocol/sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";

type ImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const PDF_EXTENSIONS = new Set(["pdf"]);

const COMMON_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "tif",
  "tiff",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "mpeg",
  "mpg",
]);

function sdkText(value: string): ContentBlockParam {
  return { type: "text", text: value };
}

function formatUriAsLink(uri: string): string {
  try {
    if (uri.startsWith("zed://")) {
      const name = path.basename(uri) || uri;
      return `[@${name}](${uri})`;
    }
    return uri;
  } catch {
    return uri;
  }
}

/** Chunking hints for Claude Code `Read` (`file_path`, optional `pages` / `offset` / `limit`). */
export function readToolGuidanceForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (PDF_EXTENSIONS.has(ext)) {
    return 'Optional `pages` string (e.g. "1-5") per Read call instead of loading the entire PDF.';
  }
  if (COMMON_IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
    return "Binary file — use Read with `file_path`; prefer bounded reads where supported.";
  }
  return "Large text — use multiple Read calls with optional `offset` and `limit`.";
}

/** Path-only workspace attach text (never embed `resource.text` from disk). */
export function workspacePromptFromFileUri(uri: string): string {
  try {
    const filePath = fileURLToPath(uri);
    const name = path.basename(filePath) || filePath;
    return [
      "Attached workspace file — use Read with required `file_path`:",
      `- file_path: ${filePath}`,
      `- name (context): ${name}`,
      readToolGuidanceForPath(filePath),
    ].join("\n");
  } catch {
    return [
      "Attached file — decode path from URI, call Read with that path as `file_path`:",
      uri,
      'Chunk PDFs with `pages` (e.g. "1-5"); long text with `offset`/`limit`.',
    ].join("\n");
  }
}

function isFileSchemeUri(uri: string | undefined | null): boolean {
  return Boolean(uri?.startsWith("file://"));
}

function transformMcpCommand(text: string): string {
  const mcpMatch = text.match(/^\/mcp:([^:\s]+):(\S+)(\s+.*)?$/);
  if (mcpMatch) {
    const [, server, command, args] = mcpMatch;
    return `/${server}:${command} (MCP)${args || ""}`;
  }
  return text;
}

function processPromptChunk(
  chunk: PromptRequest["prompt"][number],
  content: ContentBlockParam[],
  context: ContentBlockParam[],
): void {
  switch (chunk.type) {
    case "text":
      content.push(sdkText(transformMcpCommand(chunk.text)));
      break;

    case "resource_link":
      content.push(
        sdkText(
          chunk.uri.startsWith("file://")
            ? workspacePromptFromFileUri(chunk.uri)
            : formatUriAsLink(chunk.uri),
        ),
      );
      break;

    case "resource":
      if ("text" in chunk.resource) {
        const uri = chunk.resource.uri;
        if (uri != null && isFileSchemeUri(uri)) {
          content.push(sdkText(workspacePromptFromFileUri(uri)));
          break;
        }

        content.push(sdkText(formatUriAsLink(uri ?? "")));
        context.push(
          sdkText(
            `\n<context ref="${uri ?? ""}">\n${chunk.resource.text}\n</context>`,
          ),
        );
      }
      break;

    case "image":
      if (chunk.data) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            data: chunk.data,
            media_type: chunk.mimeType as ImageMimeType,
          },
        });
      } else if (chunk.uri?.startsWith("http")) {
        content.push({
          type: "image",
          source: { type: "url", url: chunk.uri },
        });
      } else if (chunk.uri != null && isFileSchemeUri(chunk.uri)) {
        content.push(sdkText(workspacePromptFromFileUri(chunk.uri)));
      }
      break;

    default:
      break;
  }
}

export function promptToClaude(prompt: PromptRequest): SDKUserMessage {
  const content: ContentBlockParam[] = [];
  const context: ContentBlockParam[] = [];

  const prContext = (prompt._meta as Record<string, unknown> | undefined)
    ?.prContext;
  if (typeof prContext === "string") {
    content.push(sdkText(prContext));
  }

  for (const chunk of prompt.prompt) {
    processPromptChunk(chunk, content, context);
  }

  content.push(...context);

  return {
    type: "user",
    message: { role: "user", content },
    session_id: prompt.sessionId,
    parent_tool_use_id: null,
  };
}
