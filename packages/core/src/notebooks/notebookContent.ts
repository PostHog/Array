// Pure helpers for the "markdown notebook" content envelope. A markdown
// notebook is a notebook whose `content` JSON is exactly one
// `ph-markdown-notebook` node holding the full markdown string in its attrs.
// Semantics mirror the upstream PostHog frontend helpers
// (scenes/notebooks/Notebook/markdownNotebookV2.ts) so we detect the same
// notebooks the product does and never corrupt old-format (TipTap) content.

export const MARKDOWN_NOTEBOOK_NODE_TYPE = "ph-markdown-notebook";

// Upstream's default nodeId for the single markdown node; used as the fallback
// when no crypto.randomUUID is available.
const DEFAULT_MARKDOWN_NOTEBOOK_NODE_ID = "markdown-notebook-v2";

interface MarkdownNotebookNode {
  type: string;
  attrs?: {
    nodeId?: unknown;
    markdown?: unknown;
  };
}

// The envelope check mirrors upstream: an object (not array) whose `content`
// is exactly one node of type `ph-markdown-notebook`. Anything else is an
// old-format notebook and must be left alone.
function getMarkdownNotebookNode(
  content: unknown,
): MarkdownNotebookNode | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }
  const nodes = (content as { content?: unknown }).content;
  if (!Array.isArray(nodes) || nodes.length !== 1) {
    return null;
  }
  const node = nodes[0] as MarkdownNotebookNode | null;
  if (
    !node ||
    typeof node !== "object" ||
    node.type !== MARKDOWN_NOTEBOOK_NODE_TYPE
  ) {
    return null;
  }
  return node;
}

export function isMarkdownNotebookContent(content: unknown): boolean {
  return !!getMarkdownNotebookNode(content);
}

export function getMarkdownNotebookMarkdown(content: unknown): string | null {
  const node = getMarkdownNotebookNode(content);
  if (!node) {
    return null;
  }
  const markdown = node.attrs?.markdown;
  return typeof markdown === "string" ? markdown : "";
}

export function getMarkdownNotebookNodeId(content: unknown): string | null {
  const node = getMarkdownNotebookNode(content);
  if (!node) {
    return null;
  }
  const nodeId = node.attrs?.nodeId;
  return typeof nodeId === "string" && nodeId
    ? nodeId
    : DEFAULT_MARKDOWN_NOTEBOOK_NODE_ID;
}

export function buildMarkdownNotebookContent(
  markdown: string,
  nodeId?: string,
): {
  type: "doc";
  content: [{ type: string; attrs: { nodeId: string; markdown: string } }];
} {
  return {
    type: "doc",
    content: [
      {
        type: MARKDOWN_NOTEBOOK_NODE_TYPE,
        attrs: {
          nodeId: nodeId ?? generateNodeId(),
          markdown,
        },
      },
    ],
  };
}

function generateNodeId(): string {
  // Both browsers and Node expose crypto.randomUUID; the constant fallback
  // matches upstream's default nodeId and keeps this helper host-agnostic.
  return globalThis.crypto?.randomUUID?.() ?? DEFAULT_MARKDOWN_NOTEBOOK_NODE_ID;
}
