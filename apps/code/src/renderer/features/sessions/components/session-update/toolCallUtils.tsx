import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import type { ToolCall, ToolCallContent } from "@features/sessions/types";
import { type Icon, Minus, Plus } from "@phosphor-icons/react";
import { Box, Text } from "@radix-ui/themes";

export function ToolTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Text
      className={`text-[13px] text-gray-11${className ? ` ${className}` : ""}`}
    >
      {children}
    </Text>
  );
}

export function StatusIndicators({
  isFailed,
  wasCancelled,
}: {
  isFailed?: boolean;
  wasCancelled?: boolean;
}) {
  return (
    <>
      {isFailed && <Text className="text-[13px] text-gray-10">(Failed)</Text>}
      {wasCancelled && (
        <Text className="text-[13px] text-gray-10">(Cancelled)</Text>
      )}
    </>
  );
}

export function useToolCallStatus(
  status: ToolCall["status"],
  turnCancelled?: boolean,
  turnComplete?: boolean,
) {
  const isIncomplete = status === "pending" || status === "in_progress";
  const isLoading = isIncomplete && !turnCancelled && !turnComplete;
  const isFailed = status === "failed";
  const wasCancelled = isIncomplete && turnCancelled;
  const isComplete = status === "completed";

  return { isIncomplete, isLoading, isFailed, wasCancelled, isComplete };
}

function extractText(item: ToolCallContent | undefined): string | undefined {
  if (item?.type === "content" && item.content.type === "text") {
    return item.content.text;
  }
  return undefined;
}

export function getContentText(
  content: ToolCall["content"],
): string | undefined {
  if (!content?.length) return undefined;
  for (const item of content) {
    const text = extractText(item);
    if (text !== undefined) return text;
  }
  return undefined;
}

export interface ImageContentData {
  base64: string;
  mimeType: string;
}

export function getContentImage(
  content: ToolCall["content"],
): ImageContentData | undefined {
  if (!content?.length) return undefined;
  for (const item of content) {
    if (item.type === "content" && item.content.type === "image") {
      const { data, mimeType } = item.content;
      if (typeof data === "string" && typeof mimeType === "string") {
        return { base64: data, mimeType };
      }
    }
  }
  return undefined;
}

export function getReadToolContent(
  content: ToolCall["content"],
): string | undefined {
  const raw = getContentText(content);
  if (!raw) return undefined;

  let text = raw;
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  text = text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
  text = text
    .split("\n")
    .map((line) => line.replace(/^\s*\d+→/, ""))
    .join("\n");
  text = text.trim();

  return text || undefined;
}

export function getLineCount(content: ToolCall["content"]): number | null {
  const text = getContentText(content);
  return text ? text.split("\n").length : null;
}

const INPUT_PREVIEW_MAX_LENGTH = 60;

export function compactInput(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== "object") return undefined;
  try {
    const json = JSON.stringify(rawInput);
    if (json === "{}") return undefined;
    if (json.length <= INPUT_PREVIEW_MAX_LENGTH) return json;
    return `${json.slice(0, INPUT_PREVIEW_MAX_LENGTH)}...`;
  } catch {
    return undefined;
  }
}

export function formatInput(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== "object") return undefined;
  try {
    const json = JSON.stringify(rawInput, null, 2);
    if (json === "{}") return undefined;
    return json;
  } catch {
    return undefined;
  }
}

export function stripCodeFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

export function truncateText(
  text: string,
  maxLength: number,
  ellipsis = "…",
): string {
  if (typeof text !== "string") return String(text);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}${ellipsis}`;
}

export function getFilename(path: string): string {
  if (typeof path !== "string") return String(path);
  return path.split("/").pop() ?? path;
}

export type DiffContent = Extract<ToolCallContent, { type: "diff" }>;

export function findDiffContent(
  content: ToolCallContent[] | null | undefined,
): DiffContent | undefined {
  return content?.find((c): c is DiffContent => c.type === "diff");
}

export interface ResourceLinkData {
  uri?: string;
  name?: string;
  description?: string;
}

export function findResourceLink(
  content: ToolCall["content"],
): ResourceLinkData | undefined {
  if (!content?.length) return undefined;
  const item = content[0];
  if (item.type === "content" && item.content.type === "resource_link") {
    return item.content as { type: "resource_link" } & ResourceLinkData;
  }
  return undefined;
}

export interface ToolViewProps {
  toolCall: ToolCall;
  turnCancelled?: boolean;
  turnComplete?: boolean;
  expanded?: boolean;
}

const ICON_SIZE = 12;
const ICON_CLASS = "text-gray-12";

function Spinner({ className = ICON_CLASS }: { className?: string }) {
  return <DotsCircleSpinner size={ICON_SIZE} className={className} />;
}

export function LoadingIcon({
  icon: IconComponent,
  isLoading,
  className = ICON_CLASS,
}: {
  icon: Icon;
  isLoading: boolean;
  className?: string;
}) {
  if (isLoading) return <Spinner className={className} />;
  return <IconComponent size={ICON_SIZE} className={className} />;
}

export function ExpandableIcon({
  icon: IconComponent,
  isLoading,
  isExpandable,
  isExpanded,
}: {
  icon: Icon;
  isLoading: boolean;
  isExpandable: boolean;
  isExpanded: boolean;
}) {
  if (isLoading) return <Spinner />;
  if (!isExpandable) {
    return <IconComponent size={ICON_SIZE} className={ICON_CLASS} />;
  }
  return (
    <>
      <IconComponent
        size={ICON_SIZE}
        className={`${ICON_CLASS} group-hover:hidden`}
      />
      {isExpanded ? (
        <Minus
          size={ICON_SIZE}
          className={`hidden ${ICON_CLASS} group-hover:block`}
        />
      ) : (
        <Plus
          size={ICON_SIZE}
          className={`hidden ${ICON_CLASS} group-hover:block`}
        />
      )}
    </>
  );
}

export function ContentPre({ children }: { children: React.ReactNode }) {
  return (
    <Box className="max-h-64 overflow-auto px-3 py-2">
      <Text asChild className="text-[13px] text-gray-11">
        <pre className="m-0 whitespace-pre-wrap break-all font-mono">
          {children}
        </pre>
      </Text>
    </Box>
  );
}

export function ExpandedContentBox({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box className="mt-2 ml-5 max-w-4xl overflow-hidden rounded-lg border border-gray-6">
      <ContentPre>{children}</ContentPre>
    </Box>
  );
}
