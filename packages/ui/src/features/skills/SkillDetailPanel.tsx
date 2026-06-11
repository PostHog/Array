import { Folder, LockSimple, X } from "@phosphor-icons/react";
import type { SkillInfo } from "@posthog/shared";
import { CodeMirrorEditor } from "@posthog/ui/features/code-editor/components/CodeMirrorEditor";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { ExternalAppsOpener } from "@posthog/ui/features/task-detail/components/ExternalAppsOpener";
import { Badge, Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useState } from "react";
import { SOURCE_CONFIG } from "./SkillCard";
import { SkillFileTree } from "./SkillFileTree";
import { useSkillContents, useSkillFile } from "./useSkillContents";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return match ? content.slice(match[0].length).trimStart() : content;
}

interface SkillDetailPanelProps {
  skill: SkillInfo;
  onClose: () => void;
}

export function SkillDetailPanel({ skill, onClose }: SkillDetailPanelProps) {
  const config = SOURCE_CONFIG[skill.source];

  const [selectedFile, setSelectedFile] = useState("SKILL.md");
  const { data: contents } = useSkillContents(skill.path);
  const { data: fileContent, isLoading } = useSkillFile(
    skill.path,
    selectedFile,
  );

  const files = contents?.files ?? [];
  const isSkillMd = selectedFile === "SKILL.md";
  const body = isSkillMd && fileContent ? stripFrontmatter(fileContent) : null;

  return (
    <>
      <Flex
        direction="column"
        gap="2"
        px="3"
        py="2"
        className="shrink-0 border-b border-b-(--gray-5)"
      >
        <Flex align="start" justify="between" gap="2">
          <Text className="block min-w-0 break-words font-medium text-[13px]">
            {skill.name}
          </Text>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-0.5 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
          >
            <X size={14} />
          </button>
        </Flex>

        <Flex align="center" gap="2" wrap="wrap">
          <Badge size="1" variant="soft" color="gray">
            {config?.label ?? skill.source}
          </Badge>
          {skill.repoName && (
            <Badge size="1" variant="soft" color="gray">
              <Folder size={10} className="text-gray-9" />
              {skill.repoName}
            </Badge>
          )}
          {!skill.editable && (
            <Badge size="1" variant="soft" color="gray">
              <LockSimple size={10} className="text-gray-9" />
              Read-only
            </Badge>
          )}
          {skill.source !== "bundled" && (
            <ExternalAppsOpener targetPath={skill.path} />
          )}
        </Flex>
      </Flex>

      {files.length > 1 && (
        <Box className="max-h-[40%] shrink-0 overflow-y-auto border-b border-b-(--gray-5) py-1">
          <SkillFileTree
            files={files}
            selectedPath={selectedFile}
            onSelect={setSelectedFile}
          />
        </Box>
      )}

      <Box className="min-h-0 flex-1">
        {isSkillMd ? (
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            className="scroll-area-constrain-width h-full"
          >
            <Flex direction="column" gap="3" p="3">
              {skill.description && (
                <Text className="text-[12px] text-gray-10">
                  {skill.description}
                </Text>
              )}

              {isLoading ? (
                <Text className="text-[12px] text-gray-9">Loading...</Text>
              ) : body ? (
                <Box className="rounded border border-gray-5 bg-gray-1 px-4 py-3 text-[13px]">
                  <MarkdownRenderer content={body} />
                </Box>
              ) : (
                <Text className="text-[12px] text-gray-9">
                  No content in SKILL.md
                </Text>
              )}
            </Flex>
          </ScrollArea>
        ) : isLoading ? (
          <Box p="3">
            <Text className="text-[12px] text-gray-9">Loading...</Text>
          </Box>
        ) : fileContent != null ? (
          <CodeMirrorEditor
            content={fileContent}
            filePath={`${skill.path}/${selectedFile}`}
            relativePath={selectedFile}
            readOnly
          />
        ) : (
          <Box p="3">
            <Text className="text-[12px] text-gray-9">
              Unable to display this file
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
}
