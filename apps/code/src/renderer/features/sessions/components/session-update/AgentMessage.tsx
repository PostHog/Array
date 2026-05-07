import { HighlightedCode } from "@components/HighlightedCode";
import { Tooltip } from "@components/ui/Tooltip";
import { usePendingScrollStore } from "@features/code-editor/stores/pendingScrollStore";
import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import { usePanelLayoutStore } from "@features/panels";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useTaskStore } from "@features/tasks/stores/taskStore";
import type { FileItem } from "@hooks/useRepoFiles";
import { useRepoFiles } from "@hooks/useRepoFiles";
import { Check, Copy } from "@phosphor-icons/react";
import { Box, Code, IconButton } from "@radix-ui/themes";
import { memo, useCallback, useMemo, useState } from "react";
import type { Components } from "react-markdown";

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
  const taskId = useTaskStore((s) => s.selectedTaskId);
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
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const repoPath = useCwd(taskId ?? "");
  const { files } = useRepoFiles(repoPath ?? undefined);
  const resolved = useMemo(
    () => resolveFilename(bareFilename, files),
    [bareFilename, files],
  );

  if (!resolved) {
    return (
      <Code variant="ghost" className="text-(--accent-11) text-[13px]">
        {text}
      </Code>
    );
  }
  return <InlineFileLink text={text} resolvedPath={resolved.path} />;
}

const agentComponents: Partial<Components> = {
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
      <Code variant="ghost" className="text-(--accent-11) text-[13px]">
        {children}
      </Code>
    );
  },
};

interface AgentMessageProps {
  content: string;
}

export const AgentMessage = memo(function AgentMessage({
  content,
}: AgentMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <Box className="group/msg relative py-1 pl-3 text-[13px] [&>*:last-child]:mb-0">
      <MarkdownRenderer
        content={content}
        componentsOverride={agentComponents}
      />
      <Box className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
        <Tooltip content={copied ? "Copied!" : "Copy message"}>
          <IconButton
            size="1"
            variant="ghost"
            color={copied ? "green" : "gray"}
            onClick={handleCopy}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
});
