import { FileTextIcon } from "@radix-ui/react-icons";
import { Box, Card, Flex, Text, Tooltip } from "@radix-ui/themes";
import type { TaskArtifact } from "@shared/types";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";

interface TaskArtifactsProps {
  taskId: string;
  repoPath: string | null;
  selectedArtifact: string | null;
  onArtifactSelect: (fileName: string) => void;
}

export function TaskArtifacts({
  taskId,
  repoPath,
  selectedArtifact,
  onArtifactSelect,
}: TaskArtifactsProps) {
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);

  useEffect(() => {
    if (!repoPath || !taskId) return;

    const loadArtifacts = async () => {
      try {
        const files = await window.electronAPI?.listTaskArtifacts(
          repoPath,
          taskId,
        );
        if (files) {
          setArtifacts(files as TaskArtifact[]);
        }
      } catch (error) {
        console.error("Failed to load task artifacts:", error);
      }
    };

    loadArtifacts();

    // Auto-refresh artifacts every 5 seconds
    const interval = setInterval(() => {
      loadArtifacts();
    }, 5000);

    return () => clearInterval(interval);
  }, [repoPath, taskId]);

  if (!repoPath || artifacts.length === 0) {
    return null;
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Box mb="3">
      <Text size="1" weight="medium" mb="2" style={{ color: "var(--gray-11)" }}>
        Task Artifacts
      </Text>
      <Flex gap="2" wrap="wrap">
        {artifacts.map((artifact) => {
          const isSelected = selectedArtifact === artifact.name;
          const displayName = artifact.name.replace(/\.md$/, "");
          const modifiedTime = formatDistanceToNow(
            new Date(artifact.modifiedAt),
            {
              addSuffix: true,
            },
          );

          return (
            <Tooltip
              key={artifact.name}
              content={`${displayName} · ${formatFileSize(artifact.size)} · Modified ${modifiedTime}`}
            >
              <Card
                onClick={() => onArtifactSelect(artifact.name)}
                style={{
                  cursor: "pointer",
                  padding: "8px 12px",
                  minWidth: "120px",
                  border: isSelected
                    ? "2px solid var(--accent-9)"
                    : "1px solid var(--gray-6)",
                  backgroundColor: isSelected
                    ? "var(--accent-2)"
                    : "var(--gray-2)",
                  transition: "all 0.2s ease",
                }}
                className="artifact-card"
              >
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    <FileTextIcon
                      style={{
                        width: 16,
                        height: 16,
                        color: isSelected
                          ? "var(--accent-11)"
                          : "var(--gray-11)",
                      }}
                    />
                    <Text
                      size="2"
                      weight="medium"
                      style={{
                        color: isSelected
                          ? "var(--accent-12)"
                          : "var(--gray-12)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayName}
                    </Text>
                  </Flex>
                  <Text
                    size="1"
                    style={{
                      color: "var(--gray-10)",
                      fontSize: "10px",
                    }}
                  >
                    {formatFileSize(artifact.size)}
                  </Text>
                </Flex>
              </Card>
            </Tooltip>
          );
        })}
      </Flex>
    </Box>
  );
}
