import { fileURLToPath } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";

/**
 * Codex app-server `UserInput` (version-pinned shape from
 * codex-schema/v2/UserInput.ts). We only emit the three variants an ACP prompt
 * can produce — `text`, remote `image`, and `localImage` — so the union is
 * narrowed here rather than importing the full generated type.
 */
export type CodexUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

function textInput(text: string): CodexUserInput {
  return { type: "text", text, text_elements: [] };
}

/** A `file://` resource is surfaced as its path so codex reads it from disk. */
function resourceLinkText(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      return `Attached workspace file (read it from disk): ${fileURLToPath(uri)}`;
    } catch {
      return `Attached file: ${uri}`;
    }
  }
  return `Attached resource: ${uri}`;
}

/**
 * Maps ACP prompt content blocks to codex app-server `UserInput[]`.
 *
 * Text blocks pass through unchanged (codex requires `text_elements`, empty
 * when the host has no UI spans). Image blocks map to `image`/`localImage`
 * (base64 → data URL, `http(s)` → remote `image`, `file://` → `localImage`).
 * `embeddedContext` blocks are honored rather than dropped — mirroring the
 * Claude adapter: a `resource_link` (or `file://` `resource`) becomes a
 * path/link note, and a non-file `resource` with inline text is inlined as a
 * `<context ref>` block appended after the main content (kept salient by
 * trailing it, as Claude does). Dropped: audio, malformed images, and binary
 * (blob) embedded resources — only the text variant of a resource is inlined.
 */
export function toCodexInput(prompt: ContentBlock[]): CodexUserInput[] {
  const input: CodexUserInput[] = [];
  const context: string[] = [];
  for (const block of prompt) {
    if (block.type === "text") {
      input.push(textInput(block.text));
      continue;
    }
    if (block.type === "image") {
      const mapped = imageToCodexInput(block);
      if (mapped) {
        input.push(mapped);
      }
      continue;
    }
    if (block.type === "resource_link") {
      input.push(textInput(resourceLinkText(block.uri)));
      continue;
    }
    if (block.type === "resource" && "text" in block.resource) {
      const uri = block.resource.uri ?? "";
      if (uri.startsWith("file://")) {
        input.push(textInput(resourceLinkText(uri)));
        continue;
      }
      input.push(textInput(uri));
      context.push(
        `<context ref="${uri}">\n${block.resource.text}\n</context>`,
      );
    }
  }
  if (context.length > 0) {
    input.push(textInput(context.join("\n")));
  }
  return input;
}

/**
 * ACP `ImageContent` always declares `data`/`mimeType`, but `data` may be empty
 * when the image is referenced by `uri` instead. Prefer inline base64 (carried
 * as a data URL on codex's `image.url`), then fall back to the URI: `http(s)`
 * stays a remote `image`, `file://` becomes a `localImage` path.
 */
function imageToCodexInput(block: {
  data: string;
  mimeType: string;
  uri?: string | null;
}): CodexUserInput | undefined {
  if (block.data) {
    return {
      type: "image",
      url: `data:${block.mimeType};base64,${block.data}`,
    };
  }
  const uri = block.uri;
  if (!uri) {
    return undefined;
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return { type: "image", url: uri };
  }
  if (uri.startsWith("file://")) {
    try {
      return { type: "localImage", path: fileURLToPath(uri) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
