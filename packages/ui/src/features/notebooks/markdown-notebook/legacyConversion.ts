/**
 * Vendored from posthog
 * `frontend/src/scenes/notebooks/Notebook/markdownNotebookV2.ts` — the legacy
 * (TipTap rich-text) notebook → markdown conversion slice only. Keep diffs
 * against upstream minimal so future syncs stay easy. Local adaptations:
 * - dropped-resource, artifact, and title helpers are omitted (app-specific deps),
 * - the markdown-envelope helpers come from `@posthog/core`,
 * - the `NotebookNodeType` / `NodeKind` enums are inlined as string constants,
 * - upstream's `JSONContent` is the local recursive `RichContentJson` type.
 */

import {
  getMarkdownNotebookMarkdown,
  isMarkdownNotebookContent,
} from "@posthog/core/notebooks/notebookContent";
import {
  escapeCodeSpanText,
  escapeInlineMarkdownText,
  escapeMarkdownBlockLines,
  sanitizeNotebookLinkHref,
  serializeNode,
} from "./markdown";
import type { NotebookComponentProps, NotebookPropValue } from "./types";
import { toSerializablePropValue } from "./utils";

/** Recursive TipTap JSONContent shape (upstream RichContentEditor `JSONContent`). */
export type RichContentJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: RichContentJson[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export type NotebookContentForMarkdownConversion =
  | RichContentJson
  | RichContentJson[]
  | string
  | null
  | undefined;

// Inlined from upstream `scenes/notebooks/types` — the only enum member the
// converter references by name (the `ph-*` widget types live in the tag table).
const NotebookNodeType = {
  Mention: "ph-mention",
} as const;

// Inlined from upstream `~/queries` NodeKind — only the kinds the converter
// emits or inspects.
const NodeKind = {
  SavedInsightNode: "SavedInsightNode",
  DataVisualizationNode: "DataVisualizationNode",
  HogQLQuery: "HogQLQuery",
} as const;

export const NOTEBOOK_NODE_TYPE_TO_MARKDOWN_TAG: Record<string, string> = {
  "ph-query": "Query",
  "ph-python": "Python",
  "ph-duck-sql": "DuckSQL",
  "ph-hogql-sql": "HogQLSQL",
  "ph-sql-v2": "SQLV2",
  "ph-recording": "Recording",
  "ph-recording-playlist": "RecordingPlaylist",
  "ph-feature-flag": "FeatureFlag",
  "ph-feature-flag-code-example": "FeatureFlagCodeExample",
  "ph-experiment": "Experiment",
  "ph-early-access-feature": "EarlyAccessFeature",
  "ph-survey": "Survey",
  "ph-person": "Person",
  "ph-group": "Group",
  "ph-cohort": "Cohort",
  "ph-backlink": "Backlink",
  "ph-replay-timestamp": "ReplayTimestamp",
  "ph-image": "Image",
  "ph-person-feed": "PersonFeed",
  "ph-person-properties": "PersonProperties",
  "ph-group-properties": "GroupProperties",
  "ph-map": "Map",
  "ph-embed": "Embed",
  "ph-latex": "Latex",
  "ph-task-create": "TaskCreate",
  "ph-llm-trace": "LLMTrace",
  "ph-issues": "Issues",
  "ph-usage-metrics": "UsageMetrics",
  "ph-zendesk-tickets": "ZendeskTickets",
  "ph-related-groups": "RelatedGroups",
  "ph-customer-journey": "CustomerJourney",
  "ph-support-tickets": "SupportTickets",
};

const RICH_CONTENT_NODE_TYPE_ALIASES: Record<string, string> = {
  bullet_list: "bulletList",
  ordered_list: "orderedList",
  list_item: "listItem",
  code_block: "codeBlock",
  table_row: "tableRow",
  table_cell: "tableCell",
  table_header: "tableHeader",
};

export type NotebookMarkdownConversionOptions = {
  /**
   * Replies per v1 comment mark id, embedded into the matching `<Comment ref>` tag so
   * the discussion travels with the markdown. Threads without an entry still get an
   * empty comment thread — the anchor must never be silently dropped.
   */
  commentRepliesByMarkId?: Record<string, NotebookPropValue[]>;
  /** Display label for a mention (e.g. `@Marius`); falls back to `@member`. */
  getMentionLabel?: (memberId: number) => string | null;
};

export function convertNotebookContentToMarkdown(
  content: NotebookContentForMarkdownConversion,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const normalizedContent =
    normalizeNotebookContentForMarkdownConversion(content);

  if (typeof normalizedContent === "string") {
    return normalizedContent;
  }

  if (isMarkdownNotebookContent(normalizedContent)) {
    return getMarkdownNotebookMarkdown(normalizedContent) ?? "";
  }

  const blocks: string[] = [];
  const emittedCommentMarkIds = new Set<string>();
  for (const node of normalizedContent?.content ?? []) {
    // Each comment-marked range gets its thread right above the block holding the
    // highlight, so the margin-anchored thread aligns with the text it is about.
    for (const markId of collectCommentMarkIds(node)) {
      if (emittedCommentMarkIds.has(markId)) {
        continue;
      }
      emittedCommentMarkIds.add(markId);
      blocks.push(
        serializeNode({
          id: "",
          type: "component",
          tagName: "Comment",
          props: {
            ref: markId,
            replies: options.commentRepliesByMarkId?.[markId] ?? [],
          },
        }),
      );
    }

    const markdown = serializeRichContentNode(node, 0, options);
    if (markdown.trim().length > 0) {
      blocks.push(markdown);
    }
  }

  return blocks.join("\n\n");
}

function normalizeNotebookContentForMarkdownConversion(
  content: NotebookContentForMarkdownConversion,
): RichContentJson | string | null | undefined {
  if (typeof content === "string") {
    const parsedContent = parseJsonEncodedNotebookContent(content);
    return parsedContent ?? content;
  }

  if (Array.isArray(content)) {
    return { type: "doc", content };
  }

  return content;
}

function parseJsonEncodedNotebookContent(
  content: string,
): RichContentJson | string | null {
  const trimmedContent = content.trim();
  if (
    !trimmedContent ||
    (!trimmedContent.startsWith("{") &&
      !trimmedContent.startsWith("[") &&
      !trimmedContent.startsWith('"'))
  ) {
    return null;
  }

  try {
    const parsedContent = JSON.parse(trimmedContent) as unknown;
    if (typeof parsedContent === "string") {
      return parseJsonEncodedNotebookContent(parsedContent) ?? parsedContent;
    }
    if (Array.isArray(parsedContent)) {
      return { type: "doc", content: parsedContent as RichContentJson[] };
    }
    if (parsedContent && typeof parsedContent === "object") {
      return parsedContent as RichContentJson;
    }
  } catch {
    return null;
  }

  return null;
}

function collectCommentMarkIds(node: RichContentJson): string[] {
  const markIds: string[] = [];
  const visit = (current: RichContentJson): void => {
    for (const mark of current.marks ?? []) {
      if (
        mark.type === "comment" &&
        typeof mark.attrs?.id === "string" &&
        mark.attrs.id
      ) {
        markIds.push(mark.attrs.id);
      }
    }
    for (const child of current.content ?? []) {
      visit(child);
    }
  };
  visit(node);
  return markIds;
}

function serializeRichContentNode(
  node: RichContentJson,
  listDepth = 0,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const nodeType = getRichContentNodeType(node);

  if (nodeType === "text") {
    return escapeMarkdownBlockLines(serializeInlineNode(node, options));
  }

  if (nodeType === "heading") {
    const level =
      typeof node.attrs?.level === "number"
        ? Math.min(Math.max(node.attrs.level, 1), 6)
        : 1;
    return `${"#".repeat(level)} ${serializeInlineContent(node.content, options)}`;
  }

  if (nodeType === "paragraph") {
    return escapeMarkdownBlockLines(
      serializeInlineContent(node.content, options),
    );
  }

  if (nodeType === "blockquote") {
    return serializeBlockquoteNode(node, listDepth, options);
  }

  if (
    nodeType === "bulletList" ||
    nodeType === "orderedList" ||
    nodeType === "taskList"
  ) {
    return serializeList(node, nodeType === "orderedList", listDepth, options);
  }

  if (nodeType === "horizontalRule") {
    return "---";
  }

  if (nodeType === "codeBlock") {
    const language =
      typeof node.attrs?.language === "string" ? node.attrs.language : "";
    // Code text must stay verbatim (no inline escaping), and serializeNode picks a fence
    // longer than any backtick run in the content
    const text = (node.content ?? [])
      .map((child) =>
        getRichContentNodeType(child) === "hardBreak"
          ? "\n"
          : (child.text ?? ""),
      )
      .join("");
    return serializeNode({
      id: "",
      type: "code",
      language: language || undefined,
      text,
    });
  }

  if (nodeType === "table") {
    return serializeTable(node, options);
  }

  if (nodeType === "ph-text") {
    return serializeLegacyTextNode(node);
  }

  if (nodeType === "ph-insight") {
    return serializeLegacyInsightNode(node);
  }

  if (nodeType === "ph-dashboard") {
    return serializeLegacyDashboardNode(node);
  }

  if (nodeType === "query") {
    return serializeLegacyQueryNode(node);
  }

  if (nodeType === "ph-link") {
    return serializeLegacyLinkNode(node, options);
  }

  if (nodeType === "callout") {
    return serializeCalloutNode(node, options);
  }

  const markdownTagName = nodeType
    ? NOTEBOOK_NODE_TYPE_TO_MARKDOWN_TAG[nodeType]
    : undefined;
  if (markdownTagName) {
    return serializeNode({
      id: "",
      type: "component",
      tagName: markdownTagName,
      props: withDefaultHiddenFilters(getSerializableAttrs(node.attrs)),
    });
  }

  const childMarkdown = (node.content ?? [])
    .map((child) => serializeRichContentNode(child, listDepth, options))
    .filter(Boolean)
    .join("\n\n");
  if (childMarkdown || !nodeType) {
    return childMarkdown;
  }

  return serializeUnknownRichContentNode(node);
}

function serializeLegacyTextNode(node: RichContentJson): string {
  const body = node.attrs?.body;
  return typeof body === "string"
    ? body
    : serializeUnknownRichContentNode(node);
}

function serializeLegacyInsightNode(node: RichContentJson): string {
  const insightShortId =
    typeof node.attrs?.short_id === "string"
      ? node.attrs.short_id
      : node.attrs?.id;
  if (typeof insightShortId !== "string" || !insightShortId) {
    return serializeUnknownRichContentNode(node);
  }

  return serializeNode({
    id: "",
    type: "component",
    tagName: "Query",
    props: withDefaultHiddenFilters({
      query: { kind: NodeKind.SavedInsightNode, shortId: insightShortId },
    }),
  });
}

function serializeLegacyDashboardNode(node: RichContentJson): string {
  const dashboardId = node.attrs?.id;
  if (typeof dashboardId !== "string" && typeof dashboardId !== "number") {
    return serializeUnknownRichContentNode(node);
  }

  return escapeMarkdownBlockLines(
    escapeInlineMarkdownText(`Dashboard ${String(dashboardId)}`),
  );
}

function serializeLegacyQueryNode(node: RichContentJson): string {
  const props = getSerializableAttrs(node.attrs);
  const query = props.query;
  if (isNotebookObjectProp(query) && query.kind === NodeKind.HogQLQuery) {
    props.query = { kind: NodeKind.DataVisualizationNode, source: query };
  }

  return serializeNode({
    id: "",
    type: "component",
    tagName: "Query",
    props: withDefaultHiddenFilters(props),
  });
}

function serializeLegacyLinkNode(
  node: RichContentJson,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const href = typeof node.attrs?.href === "string" ? node.attrs.href : null;
  const sanitizedHref = href ? sanitizeNotebookLinkHref(href) : null;
  const label = serializeInlineContent(node.content, options).trim();

  if (sanitizedHref) {
    return `[${label || escapeInlineMarkdownText(sanitizedHref)}](${sanitizedHref})`;
  }

  if (label) {
    return label;
  }

  if (href?.trim()) {
    return escapeMarkdownBlockLines(escapeInlineMarkdownText(href.trim()));
  }

  return serializeUnknownRichContentNode(node);
}

// The markdown notebook blockquote only holds inline text (and list lines), so block content
// inside a v1 blockquote or callout — embedded cards like Query/Python, headings, code blocks,
// tables, nested quotes — is emitted as standalone blocks that split the quote. Quoting those
// lines instead would produce markdown the parser can only read back as escaped literal text,
// destroying the nodes on the next save.
function isBlockquotableRichContentNode(
  node: RichContentJson,
  serialized: string,
): boolean {
  const nodeType = getRichContentNodeType(node);
  if (nodeType === "paragraph" || nodeType === "text") {
    return true;
  }
  // Blockquoted headings parse back (`> ## Heading`), but only as a single line — a heading
  // whose content spilled onto extra lines splits out of the quote instead.
  if (nodeType === "heading") {
    return !serialized.includes("\n");
  }
  // Blockquoted lists parse back (`> - item`), but only while every line is a list line — a
  // list that spilled block content into standalone blocks splits out of the quote with them.
  if (LIST_NODE_TYPES.has(nodeType ?? "")) {
    return !serialized.includes("\n\n");
  }
  return false;
}

function serializeBlockquoteNode(
  node: RichContentJson,
  listDepth: number,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const blocks: string[] = [];
  let pendingQuoteLines: string[] = [];
  const flushQuoteLines = (): void => {
    if (pendingQuoteLines.length) {
      blocks.push(pendingQuoteLines.map((line) => `> ${line}`).join("\n"));
      pendingQuoteLines = [];
    }
  };

  for (const child of node.content ?? []) {
    const childMarkdown = serializeRichContentNode(child, listDepth, options);
    if (isBlockquotableRichContentNode(child, childMarkdown)) {
      pendingQuoteLines.push(...childMarkdown.split("\n"));
    } else if (childMarkdown.trim()) {
      flushQuoteLines();
      blocks.push(childMarkdown);
    }
  }
  flushQuoteLines();

  return blocks.join("\n\n");
}

function serializeCalloutNode(
  node: RichContentJson,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const emoji =
    typeof node.attrs?.emoji === "string" && node.attrs.emoji.trim()
      ? escapeInlineMarkdownText(node.attrs.emoji.trim())
      : "";
  const blocks: string[] = [];
  let pendingQuoteBodies: string[] = [];
  let emojiPlaced = false;
  const flushQuoteBodies = (): void => {
    if (!pendingQuoteBodies.length) {
      return;
    }
    let body = pendingQuoteBodies.join("\n\n");
    if (emoji && !emojiPlaced) {
      body = `${emoji} ${body}`;
      emojiPlaced = true;
    }
    blocks.push(
      body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    );
    pendingQuoteBodies = [];
  };

  for (const child of node.content ?? []) {
    const childMarkdown = serializeRichContentNode(child, 0, options);
    if (!childMarkdown.trim()) {
      continue;
    }
    if (isBlockquotableRichContentNode(child, childMarkdown)) {
      pendingQuoteBodies.push(childMarkdown);
    } else {
      flushQuoteBodies();
      blocks.push(childMarkdown);
    }
  }
  flushQuoteBodies();

  if (emoji && !emojiPlaced) {
    blocks.unshift(`> ${emoji}`);
  }

  if (!blocks.length) {
    return serializeUnknownRichContentNode(node);
  }

  return blocks.join("\n\n");
}

function isNotebookObjectProp(
  value: NotebookPropValue | undefined,
): value is Record<string, NotebookPropValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function serializeUnknownRichContentNode(node: RichContentJson): string {
  // An unmapped leaf node must not vanish on upgrade — preserve it as a component the
  // editor renders with its unknown-tag fallback
  const attrs = getSerializableAttrs(node.attrs);
  const props: NotebookComponentProps = node.type
    ? { nodeType: node.type, ...attrs }
    : attrs;
  if (node.type) {
    props.nodeType = node.type;
  }

  return serializeNode({
    id: "",
    type: "component",
    tagName: "UnknownNode",
    props,
  });
}

function serializeInlineContent(
  content: RichContentJson[] | undefined,
  options: NotebookMarkdownConversionOptions = {},
): string {
  return (content ?? [])
    .map((node) => serializeInlineNode(node, options))
    .join("");
}

function serializeInlineNode(
  node: RichContentJson,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const nodeType = getRichContentNodeType(node);

  if (nodeType === "text") {
    const isCodeText = (node.marks ?? []).some((mark) => mark.type === "code");
    // Literal `*`/`` ` ``/`[` in legacy text must not become formatting after the upgrade
    const escapedText = isCodeText
      ? escapeCodeSpanText(node.text ?? "")
      : escapeInlineMarkdownText(node.text ?? "");
    return applyMarks(escapedText, node.marks);
  }
  if (nodeType === "hardBreak") {
    return "\n";
  }
  if (nodeType === NotebookNodeType.Mention) {
    return serializeMentionNode(node, options);
  }
  return serializeInlineContent(node.content, options);
}

/** Mentions keep their member id: `<mention id="5">@Marius</mention>`. */
function serializeMentionNode(
  node: RichContentJson,
  options: NotebookMarkdownConversionOptions,
): string {
  const memberId = typeof node.attrs?.id === "number" ? node.attrs.id : null;
  const attrLabel =
    typeof node.attrs?.label === "string" && node.attrs.label.trim()
      ? node.attrs.label.trim()
      : null;
  const lookedUpLabel =
    memberId !== null ? options.getMentionLabel?.(memberId) : null;
  const label = attrLabel ?? lookedUpLabel ?? "@member";
  const displayLabel = label.startsWith("@") ? label : `@${label}`;
  if (memberId === null) {
    return escapeInlineMarkdownText(displayLabel);
  }
  return `<mention id=${JSON.stringify(String(memberId))}>${escapeInlineMarkdownText(displayLabel)}</mention>`;
}

function applyMarks(text: string, marks: RichContentJson["marks"]): string {
  // Comment marks become `<ref>` anchors and wrap outermost, so the tag encloses the
  // fully formatted text.
  const commentMarkIds = (marks ?? [])
    .filter(
      (mark) =>
        mark.type === "comment" &&
        typeof mark.attrs?.id === "string" &&
        mark.attrs.id,
    )
    .map((mark) => mark.attrs?.id as string);
  const formattedText = applyFormattingMarks(text, marks);
  return commentMarkIds.reduce(
    (markedText, markId) =>
      `<ref id=${JSON.stringify(markId)}>${markedText}</ref>`,
    formattedText,
  );
}

function applyFormattingMarks(
  text: string,
  marks: RichContentJson["marks"],
): string {
  return (marks ?? []).reduce((markedText, mark) => {
    if (mark.type === "bold" || mark.type === "strong") {
      return `**${markedText}**`;
    }
    if (mark.type === "italic" || mark.type === "em") {
      return `*${markedText}*`;
    }
    if (mark.type === "underline") {
      return `<u>${markedText}</u>`;
    }
    if (mark.type === "strike") {
      return `~~${markedText}~~`;
    }
    if (mark.type === "code") {
      return `\`${markedText}\``;
    }
    if (mark.type === "link" && typeof mark.attrs?.href === "string") {
      const href = sanitizeNotebookLinkHref(mark.attrs.href);
      return href ? `[${markedText}](${href})` : markedText;
    }
    return markedText;
  }, text);
}

const LIST_NODE_TYPES = new Set(["bulletList", "orderedList", "taskList"]);
const LIST_ITEM_NODE_TYPES = new Set(["listItem", "taskItem"]);

function getRichContentNodeType(node: RichContentJson): string | undefined {
  return node.type
    ? (RICH_CONTENT_NODE_TYPE_ALIASES[node.type] ?? node.type)
    : undefined;
}

function serializeList(
  node: RichContentJson,
  ordered: boolean,
  depth: number,
  options: NotebookMarkdownConversionOptions = {},
): string {
  // The markdown notebook list model only holds one inline line per item, so block content inside a
  // list item (extra paragraphs, code blocks, quotes) is emitted as standalone blocks after the item,
  // splitting the list rather than dropping the content.
  const blocks: string[] = [];
  let pendingListLines: string[] = [];
  const flushListLines = (): void => {
    if (pendingListLines.length) {
      blocks.push(pendingListLines.join("\n"));
      pendingListLines = [];
    }
  };

  const items = (node.content ?? []).filter((child) =>
    LIST_ITEM_NODE_TYPES.has(getRichContentNodeType(child) ?? ""),
  );
  items.forEach((item, index) => {
    const { listLines, trailingBlocks } = serializeListItem(
      item,
      ordered,
      depth,
      index,
      options,
    );
    pendingListLines.push(...listLines);
    if (trailingBlocks.length) {
      flushListLines();
      blocks.push(...trailingBlocks);
    }
  });
  flushListLines();

  return blocks.join("\n\n");
}

function serializeListItem(
  item: RichContentJson,
  ordered: boolean,
  depth: number,
  index: number,
  options: NotebookMarkdownConversionOptions = {},
): { listLines: string[]; trailingBlocks: string[] } {
  const marker = ordered ? `${index + 1}.` : "-";
  const children = item.content ?? [];
  const itemType = getRichContentNodeType(item);
  const firstParagraph = children.find(
    (child) => getRichContentNodeType(child) === "paragraph",
  );
  const nestedLists = children.filter((child) =>
    LIST_NODE_TYPES.has(getRichContentNodeType(child) ?? ""),
  );
  const extraBlocks = children.filter(
    (child) =>
      child !== firstParagraph &&
      !LIST_NODE_TYPES.has(getRichContentNodeType(child) ?? ""),
  );
  const checkbox =
    itemType === "taskItem" ? (item.attrs?.checked ? "[x] " : "[ ] ") : "";
  // List lines cannot contain raw newlines in the markdown notebook model
  const itemText = (
    firstParagraph
      ? serializeInlineContent(firstParagraph.content, options)
      : ""
  ).replace(/\s*\n\s*/g, " ");
  const listLines = [
    `${"  ".repeat(depth)}${marker} ${checkbox}${itemText}`.trimEnd(),
  ];

  for (const nestedList of nestedLists) {
    const nestedMarkdown = serializeRichContentNode(
      nestedList,
      depth + 1,
      options,
    );
    if (nestedMarkdown) {
      listLines.push(nestedMarkdown);
    }
  }

  const trailingBlocks = extraBlocks
    .map((child) => serializeRichContentNode(child, 0, options))
    .filter((block) => block.trim().length > 0);

  return { listLines, trailingBlocks };
}

function serializeTable(
  node: RichContentJson,
  options: NotebookMarkdownConversionOptions = {},
): string {
  const rows = (node.content ?? []).filter(
    (child) => getRichContentNodeType(child) === "tableRow",
  );
  if (!rows.length) {
    return "";
  }

  const serializedRows = rows.map((row) =>
    (row.content ?? [])
      .filter(
        (cell) =>
          getRichContentNodeType(cell) === "tableCell" ||
          getRichContentNodeType(cell) === "tableHeader",
      )
      .map((cell) =>
        (cell.content ?? [])
          .map((child) => serializeRichContentNode(child, 0, options))
          .join(" ")
          .replace(/\s*\n\s*/g, " ")
          // Plain-text pipes are already escaped inline; only escape the rest (code spans),
          // skipping `\X` pairs so they aren't double-escaped
          .replace(/\\[\s\S]|\|/g, (match) => (match === "|" ? "\\|" : match)),
      ),
  );
  const columnCount = Math.max(...serializedRows.map((row) => row.length));
  const header = normalizeTableRow(serializedRows[0], columnCount);
  const body = serializedRows
    .slice(1)
    .map((row) => normalizeTableRow(row, columnCount));
  const separator = Array.from({ length: columnCount }, () => "---");
  const rowsToRender = [header, separator, ...body];

  return rowsToRender.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function normalizeTableRow(
  row: string[] | undefined,
  columnCount: number,
): string[] {
  return Array.from({ length: columnCount }, (_, index) => row?.[index] ?? "");
}

function getSerializableAttrs(
  attrs: Record<string, unknown> | undefined,
): NotebookComponentProps {
  return Object.entries(attrs ?? {}).reduce<NotebookComponentProps>(
    (props, [key, value]) => {
      const serializableValue = toSerializablePropValue(
        reviveJsonEncodedAttr(value),
      );
      if (serializableValue !== undefined) {
        props[key] = serializableValue;
      }
      return props;
    },
    {},
  );
}

function withDefaultHiddenFilters(
  props: NotebookComponentProps,
): NotebookComponentProps {
  if (
    typeof props.hideFilters === "boolean" ||
    typeof props.edit === "boolean"
  ) {
    return props;
  }
  return { ...props, hideFilters: true };
}

// Widget node attributes round-trip through HTML as JSON strings (NodeWrapper's jsonAttr), so a
// persisted v1 node can carry an attr like `query` as the JSON *string* `'{"kind":...}'` rather than
// the object. Serializing that string verbatim emits `query="..."`, which parses back as a string and
// renders an empty Query node. Revive object/array-shaped JSON strings to their real value so they
// serialize as `query={{...}}`. Only `{`/`[`-prefixed strings are touched, so plain text and HogQL
// query strings (which never start that way) are left untouched.
function reviveJsonEncodedAttr(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
}
