import { Cross2Icon } from "@radix-ui/react-icons";
import { Box, Button, Flex, Heading, IconButton } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { RichTextEditor } from "./RichTextEditor";

interface PlanEditorProps {
  taskId: string;
  repoPath: string;
  fileName?: string; // Defaults to "plan.md"
  initialContent?: string;
  onClose?: () => void;
  onSave?: (content: string) => void;
}

export function PlanEditor({
  taskId,
  repoPath,
  fileName = "plan.md",
  initialContent,
  onClose,
  onSave,
}: PlanEditorProps) {
  const [content, setContent] = useState(initialContent || "");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Load file content on mount if not provided
  useEffect(() => {
    if (!initialContent && repoPath && taskId) {
      const loadFileContent = async () => {
        try {
          let fileContent: string | null = null;

          if (fileName === "plan.md") {
            fileContent = await window.electronAPI?.readPlanFile(
              repoPath,
              taskId,
            );
          } else {
            fileContent = await window.electronAPI?.readTaskArtifact(
              repoPath,
              taskId,
              fileName,
            );
          }

          if (fileContent) {
            setContent(fileContent);
          }
        } catch (error) {
          console.error("Failed to load file:", error);
        }
      };
      loadFileContent();
    }
  }, [taskId, repoPath, fileName, initialContent]);

  const handleSave = async () => {
    if (!repoPath || !taskId) return;

    setIsSaving(true);
    try {
      if (fileName === "plan.md") {
        await window.electronAPI?.writePlanFile(repoPath, taskId, content);
      } else {
        // For other artifacts, we'll need to add a write API
        // For now, log a warning
        console.warn(
          `Saving ${fileName} - generic artifact writing not yet implemented`,
        );
      }
      setLastSaved(new Date());
      onSave?.(content);
    } catch (error) {
      console.error("Failed to save file:", error);
      alert("Failed to save file. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box
      height="100%"
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--gray-1)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Flex
        p="3"
        align="center"
        justify="between"
        style={{
          borderBottom: "1px solid var(--gray-6)",
          backgroundColor: "var(--gray-2)",
        }}
      >
        <Flex align="center" gap="3">
          <Heading size="4">{fileName.replace(/\.md$/, "")}</Heading>
          {lastSaved && (
            <Box
              style={{
                fontSize: "12px",
                color: "var(--gray-11)",
              }}
            >
              Last saved: {lastSaved.toLocaleTimeString()}
            </Box>
          )}
        </Flex>
        <Flex gap="2" align="center">
          <Button onClick={handleSave} disabled={isSaving} size="2">
            {isSaving ? "Saving..." : "Save Plan"}
          </Button>
          {onClose && (
            <IconButton
              variant="ghost"
              size="2"
              onClick={onClose}
              title="Close plan editor"
            >
              <Cross2Icon />
            </IconButton>
          )}
        </Flex>
      </Flex>

      {/* Editor */}
      <Box
        flexGrow="1"
        p="4"
        style={{
          overflowY: "auto",
        }}
      >
        <RichTextEditor
          value={content}
          onChange={setContent}
          repoPath={repoPath}
          placeholder="Your implementation plan will appear here..."
          showToolbar={true}
        />
      </Box>
    </Box>
  );
}
