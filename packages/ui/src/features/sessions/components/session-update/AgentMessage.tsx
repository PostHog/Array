import { Check, Copy } from "@phosphor-icons/react";
import { useHostTRPCClient } from "@posthog/host-router/react";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { Box, Code, IconButton } from "@radix-ui/themes";
import { memo, useCallback, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import { HighlightedCode } from "../../../../primitives/HighlightedCode";
import { Tooltip } from "../../../../primitives/Tooltip";
import { track } from "../../../../shell/analytics";
import { openExternalUrl } from "../../../../shell/openExternal";
import { usePendingScrollStore } from "../../../code-editor/pendingScrollStore";
import { MarkdownRenderer } from "../../../editor/components/MarkdownRenderer";
import { StreamingMarkdown } from "../../../editor/components/StreamingMarkdown";
import { useSmoothedText } from "../../../editor/components/useSmoothedText";
import { usePanelLayoutStore } from "../../../panels/panelLayoutStore";
import type { FileItem } from "../../../repo-files/useRepoFiles";
import { useRepoFiles } from "../../../repo-files/useRepoFiles";
import { useCwd } from "../../../sidebar/useCwd";
import { useSessionTaskId } from "../../useSessionTaskId";

const FILE_WITH_DIR_RE =
  /^(?:\/|\.\.?\/|[a-zA-Z]:\\)?(?:[\w.@-]+\/)+[\w.@-]+\.\w+(?::\d+(?:-\d+)?)?$/;
const BARE_FILE_RE = /^[\w.@-]+\.\w+(?::\d+(?:-\d+)?)?$/;

function hasDirectoryPath(text: string): boolean {
  return FILE_WITH_DIR_RE.test(text);
}

function looksLikeBareFilename(text: string): boolean {
  return BARE_FILE_RE.test(text);
}

function parseFilePath(text: string): { filePath: string; lineSuffix: string } {
  const match = text.match(/^(.+?)(?::(\d+(?:-\d+)?))?$/);
  if (!match) return { filePath: text, lineSuffix: "" };
  return { filePath: match[1], lineSuffix: match[2] ?? "" };
}

function resolveFilename(filename: string, files: FileItem[]): FileItem | null {
  const matches = files.filter((f) => f.name === filename);
  if (matches.length === 1) return matches[0];
  return null;
}

function InlineFileLink({
  text,
  resolvedPath,
}: {
  text: string;
  resolvedPath?: string;
}) {
  const { filePath: rawPath, lineSuffix } = parseFilePath(text);
  const filePath = resolvedPath ?? rawPath;
  const filename = rawPath.split("/").pop() ?? rawPath;
  const taskId = useSessionTaskId();
  const repoPath = useCwd(taskId ?? "");
  const openFileInSplit = usePanelLayoutStore((s) => s.openFileInSplit);
  const requestScroll = usePendingScrollStore((s) => s.requestScroll);

  const handleClick = useCallback(() => {
    if (!taskId) return;
    const relativePath =
      repoPath && filePath.startsWith(`${repoPath}/`)
        ? filePath.slice(repoPath.length + 1)
        : filePath;
    const absolutePath = repoPath
      ? `${repoPath}/${relativePath}`
      : relativePath;
    if (lineSuffix) {
      const line = Number.parseInt(lineSuffix.split("-")[0], 10);
      if (line > 0) requestScroll(absolutePath, line);
    }
    openFileInSplit(taskId, relativePath, true);
  }, [taskId, filePath, lineSuffix, repoPath, openFileInSplit, requestScroll]);

  const tooltipText = resolvedPath ?? text;

  return (
    <Tooltip content={tooltipText}>
      <button
        type="button"
        onClick={taskId ? handleClick : undefined}
        disabled={!taskId}
        className={`m-0 inline border-0 bg-transparent p-0 font-[inherit] text-(--accent-11) text-[length:inherit] ${taskId ? "cursor-pointer underline decoration-(--accent-a8) underline-offset-2 hover:decoration-(--accent-11)" : ""}`}
      >
        {filename}
        {lineSuffix ? `:${lineSuffix}` : ""}
      </button>
    </Tooltip>
  );
}

function BareFileLink({ text }: { text: string }) {
  const { filePath: bareFilename } = parseFilePath(text);
  const taskId = useSessionTaskId();
  const repoPath = useCwd(taskId ?? "");
  const { files } = useRepoFiles(repoPath ?? undefined);
  const resolved = useMemo(
    () => resolveFilename(bareFilename, files),
    [bareFilename, files],
  );

  if (!resolved) {
    return (
      <Code variant="ghost" className="border border-border text-[13px]">
        {text}
      </Code>
    );
  }
  return <InlineFileLink text={text} resolvedPath={resolved.path} />;
}

function ChatLink({
  href,
  children,
}: {
  href?: string;
  children: React.ReactNode;
}) {
  const taskId = useSessionTaskId();
  const openBrowserUrl = usePanelLayoutStore((s) => s.openBrowserUrl);
  const hostClient = useHostTRPCClient();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!href) return;
      e.preventDefault();
      if (taskId) {
        openBrowserUrl(taskId, href);
      }
      track(ANALYTICS_EVENTS.LINK_CLICKED_IN_CHAT, {
        destination: "embedded_browser",
      });
    },
    [href, taskId, openBrowserUrl],
  );

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      if (!href) return;
      e.preventDefault();
      const result = await hostClient.contextMenu.showLinkContextMenu.mutate({
        url: href,
      });
      if (!result.action) return;
      switch (result.action.type) {
        case "open-embedded":
          if (taskId) openBrowserUrl(taskId, href);
          track(ANALYTICS_EVENTS.LINK_CLICKED_IN_CHAT, {
            destination: "embedded_browser",
          });
          break;
        case "open-external":
          openExternalUrl(href);
          track(ANALYTICS_EVENTS.LINK_CLICKED_IN_CHAT, {
            destination: "system_browser",
          });
          break;
        case "copy-url":
          navigator.clipboard.writeText(href);
          track(ANALYTICS_EVENTS.LINK_CLICKED_IN_CHAT, {
            destination: "copy_link",
          });
          break;
      }
    },
    [href, taskId, openBrowserUrl, hostClient],
  );

  return (
    <a
      href={href}
      onClick={handleClick}
      onContextMenu={(e) => void handleContextMenu(e)}
      className="markdown-link inline-flex cursor-pointer items-center gap-[2px]"
    >
      {children}
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        stroke="var(--accent-11)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="opens in app browser"
        role="img"
        className="ml-1 shrink-0"
      >
        <path d="M4.5 1.5H2.25C1.836 1.5 1.5 1.836 1.5 2.25V9.75C1.5 10.164 1.836 10.5 2.25 10.5H9.75C10.164 10.5 10.5 10.164 10.5 9.75V7.5" />
        <path d="M7.5 1.5H10.5V4.5" />
        <path d="M5.25 6.75L10.5 1.5" />
      </svg>
    </a>
  );
}

const agentComponents: Partial<Components> = {
  a: ({ href, children }) => <ChatLink href={href}>{children}</ChatLink>,
  code: ({ children, className }) => {
    const langMatch = className?.match(/language-(\w+)/);
    if (langMatch) {
      return (
        <HighlightedCode
          code={String(children).replace(/\n$/, "")}
          language={langMatch[1]}
        />
      );
    }

    const text = String(children).replace(/\n$/, "");
    if (hasDirectoryPath(text)) {
      return <InlineFileLink text={text} />;
    }

    if (looksLikeBareFilename(text)) {
      return <BareFileLink text={text} />;
    }

    return (
      <Code
        variant="ghost"
        className="border border-border bg-gray-3 text-[13px]"
      >
        {children}
      </Code>
    );
  },
};

interface AgentMessageProps {
  content: string;
  /** Active (still-streaming) message: smooth the reveal and block-split the
   *  markdown so each token only re-parses the tail. Completed messages parse
   *  once via MarkdownRenderer for a single, fully-correct render. */
  isStreaming?: boolean;
}

export const AgentMessage = memo(function AgentMessage({
  content,
  isStreaming = false,
}: AgentMessageProps) {
  const [copied, setCopied] = useState(false);
  const smoothed = useSmoothedText(content);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <Box className="group/msg relative pl-3 text-[13px] [&>*:last-child]:mb-0 [&_p]:leading-[1.9]">
      {isStreaming ? (
        <StreamingMarkdown
          content={smoothed}
          componentsOverride={agentComponents}
        />
      ) : (
        <MarkdownRenderer
          content={content}
          componentsOverride={agentComponents}
        />
      )}
      <Box className="absolute top-1 left-full ml-2 opacity-0 transition-opacity group-hover/msg:opacity-100">
        <Tooltip content={copied ? "Copied!" : "Copy message"}>
          <IconButton
            size="1"
            variant="ghost"
            color={copied ? "green" : "gray"}
            onClick={handleCopy}
            aria-label="Copy message"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
});
