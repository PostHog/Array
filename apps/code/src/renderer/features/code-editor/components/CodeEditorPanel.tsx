import { PanelMessage } from "@components/ui/PanelMessage";
import { Tooltip } from "@components/ui/Tooltip";
import { CodeMirrorEditor } from "@features/code-editor/components/CodeMirrorEditor";
import { EnrichmentPopover } from "@features/code-editor/components/EnrichmentPopover";
import { useCloudFileContent } from "@features/code-editor/hooks/useCloudFileContent";
import { useFileEnrichment } from "@features/code-editor/hooks/useFileEnrichment";
import { useMarkdownViewerStore } from "@features/code-editor/stores/markdownViewerStore";
import { isMarkdownFile } from "@features/code-editor/utils/markdownUtils";
import { getRelativePath } from "@features/code-editor/utils/pathUtils";
import { usePanelLayoutStore } from "@features/panels";
import { useFileTreeStore } from "@features/right-sidebar/stores/fileTreeStore";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useIsWorkspaceCloudRun } from "@features/workspace/hooks/useWorkspace";
import { Check, Code, Copy, Eye } from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { getImageMimeType, isImageFile } from "@shared/constants/image";
import type { Task } from "@shared/types";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CodeEditorPanelProps {
  taskId: string;
  task: Task;
  absolutePath: string;
}

export function CodeEditorPanel({
  taskId,
  task: _task,
  absolutePath,
}: CodeEditorPanelProps) {
  const trpcReact = useTRPC();
  const repoPath = useCwd(taskId);
  const isInsideRepo = !!repoPath && absolutePath.startsWith(repoPath);
  const filePath = getRelativePath(absolutePath, repoPath);
  const isImage = isImageFile(absolutePath);
  const isMarkdown = isMarkdownFile(absolutePath);
  const preferRendered = useMarkdownViewerStore((s) => s.preferRendered);
  const togglePreferRendered = useMarkdownViewerStore(
    (s) => s.togglePreferRendered,
  );
  const openFileInSplit = usePanelLayoutStore((s) => s.openFileInSplit);
  const expandToFile = useFileTreeStore((s) => s.expandToFile);
  const [copied, setCopied] = useState(false);

  const handleMarkdownLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      e.preventDefault();
      if (href.startsWith("http://") || href.startsWith("https://")) {
        trpcClient.os.openExternal.mutate({ url: href });
        return;
      }
      const cleanHref = href.replace(/^\.\//, "");
      const dir = filePath.includes("/")
        ? filePath.slice(0, filePath.lastIndexOf("/"))
        : "";
      const resolved = dir ? `${dir}/${cleanHref}` : cleanHref;
      if (repoPath) {
        expandToFile(taskId, `${repoPath}/${resolved}`);
      }
      openFileInSplit(taskId, resolved);
    },
    [filePath, taskId, repoPath, openFileInSplit, expandToFile],
  );

  const markdownComponents: Components = useMemo(
    () => ({
      a: ({ href, children }) => (
        <Tooltip content={href ?? ""}>
          <a
            href={href ?? "#"}
            onClick={(e) => handleMarkdownLinkClick(e, href ?? "")}
            className="cursor-pointer text-(--accent-11) underline"
          >
            {children}
          </a>
        </Tooltip>
      ),
    }),
    [handleMarkdownLinkClick],
  );

  const isCloudRun = useIsWorkspaceCloudRun(taskId);
  const cloudFile = useCloudFileContent(
    taskId,
    filePath,
    isCloudRun && !isImage,
  );

  const repoQuery = useQuery(
    trpcReact.fs.readRepoFile.queryOptions(
      { repoPath: repoPath ?? "", filePath },
      { enabled: isInsideRepo && !isImage && !isCloudRun, staleTime: Infinity },
    ),
  );

  const absoluteQuery = useQuery(
    trpcReact.fs.readAbsoluteFile.queryOptions(
      { filePath: absolutePath },
      {
        enabled: !isInsideRepo && !isImage && !isCloudRun,
        staleTime: Infinity,
      },
    ),
  );

  const imageQuery = useQuery(
    trpcReact.fs.readFileAsBase64.queryOptions(
      { filePath: absolutePath },
      { enabled: isImage && !isCloudRun, staleTime: Infinity },
    ),
  );

  const localQuery = isInsideRepo ? repoQuery : absoluteQuery;
  const fileContent = isCloudRun ? cloudFile.content : localQuery.data;
  const isLoading = isCloudRun ? cloudFile.isLoading : localQuery.isLoading;
  const error = isCloudRun ? null : localQuery.error;

  const enrichment = useFileEnrichment({
    taskId,
    filePath,
    absolutePath: isInsideRepo ? absolutePath : undefined,
    content: isImage ? null : fileContent,
  });

  if (isImage) {
    if (isCloudRun) {
      return (
        <PanelMessage detail={filePath}>
          Images not available for cloud runs
        </PanelMessage>
      );
    }
    if (imageQuery.isLoading) {
      return <PanelMessage>Loading image...</PanelMessage>;
    }
    if (imageQuery.error || !imageQuery.data) {
      return (
        <PanelMessage detail={absolutePath}>Failed to load image</PanelMessage>
      );
    }
    const mimeType = getImageMimeType(absolutePath);
    return (
      <Flex
        align="center"
        justify="center"
        height="100%"
        p="4"
        className="overflow-auto"
      >
        <img
          src={`data:${mimeType};base64,${imageQuery.data}`}
          alt={filePath}
          className="max-h-[100%] max-w-[100%] object-contain"
        />
      </Flex>
    );
  }

  if (isLoading) {
    return <PanelMessage>Loading file...</PanelMessage>;
  }

  if (isCloudRun && !cloudFile.touched) {
    return (
      <PanelMessage detail={filePath}>
        File content not available — the agent did not read or write this file
      </PanelMessage>
    );
  }

  if (isCloudRun && cloudFile.touched && cloudFile.content == null) {
    return (
      <PanelMessage detail={filePath}>
        This file was deleted by the agent
      </PanelMessage>
    );
  }

  if (error || fileContent == null) {
    return (
      <PanelMessage detail={absolutePath}>Failed to load file</PanelMessage>
    );
  }

  if (fileContent.length === 0) {
    return <PanelMessage>File is empty</PanelMessage>;
  }

  if (isMarkdown) {
    const handleCopySource = () => {
      navigator.clipboard.writeText(fileContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <Flex direction="column" height="100%" className="overflow-hidden">
        <Flex
          px="3"
          py="2"
          align="center"
          justify="between"
          className="shrink-0 border-b border-b-(--gray-6)"
        >
          <Text
            color="gray"
            className="font-[var(--code-font-family)] text-[13px]"
          >
            {filePath}
          </Text>
          <Flex align="center" gap="1">
            <Tooltip content={copied ? "Copied" : "Copy source"}>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                className="cursor-pointer"
                onClick={handleCopySource}
                aria-label="Copy source"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            </Tooltip>
            <Tooltip content={preferRendered ? "View source" : "View rendered"}>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                className="cursor-pointer"
                onClick={togglePreferRendered}
              >
                {preferRendered ? <Code size={14} /> : <Eye size={14} />}
              </IconButton>
            </Tooltip>
          </Flex>
        </Flex>
        <Box className="flex-1 overflow-auto">
          {preferRendered ? (
            <Box className="plan-markdown max-w-[750px]" p="5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {fileContent}
              </ReactMarkdown>
            </Box>
          ) : (
            <CodeMirrorEditor
              content={fileContent}
              filePath={absolutePath}
              readOnly
            />
          )}
        </Box>
      </Flex>
    );
  }

  return (
    <Box height="100%" className="relative overflow-hidden">
      <CodeMirrorEditor
        content={fileContent}
        filePath={absolutePath}
        relativePath={filePath}
        readOnly
        enrichment={enrichment}
      />
      <EnrichmentPopover />
    </Box>
  );
}
