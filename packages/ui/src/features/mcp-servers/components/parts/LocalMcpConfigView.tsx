import { LOCAL_MCP_IMPORT_SERVICE } from "@posthog/core/local-mcp/identifiers";
import type { LocalMcpImportService } from "@posthog/core/local-mcp/localMcpImport";
import { useService } from "@posthog/di/react";
import { validatePostHogMcpConfig } from "@posthog/shared";
import { SkillCodeEditor } from "@posthog/ui/features/skills/SkillCodeEditor";
import { toast } from "@posthog/ui/primitives/toast";
import { Box, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const EMPTY_CONFIG = "{}\n";

function validationMessage(content: string): string | null {
  try {
    const issues = validatePostHogMcpConfig(JSON.parse(content));
    return issues[0] ?? null;
  } catch {
    return "invalid JSON";
  }
}

function saveStatus(
  isPending: boolean,
  draft: string,
  savedContent: string,
  failedContent: string | null,
): string {
  const validationError = validationMessage(draft);
  if (failedContent === draft) return "Could not save";
  if (validationError && (isPending || draft !== savedContent)) {
    return `${validationError}, saving…`;
  }
  if (validationError) return `Saved, ${validationError}`;
  if (isPending) return "Saving…";
  if (draft === savedContent) return "Saved";
  return "Saving…";
}

export function LocalMcpConfigView({ openKey }: { openKey: number }) {
  const service = useService<LocalMcpImportService>(LOCAL_MCP_IMPORT_SERVICE);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["local-mcp-config", openKey],
    queryFn: () => service.getConfigFile(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <Flex align="center" justify="center" py="6">
        <Spinner size="2" />
      </Flex>
    );
  }

  if (isError) {
    return (
      <Flex direction="column" align="center" gap="3" py="6">
        <Text color="red" className="text-sm">
          {error.message || "Failed to read local MCP configuration"}
        </Text>
        <Button variant="outline" size="1" onClick={() => refetch()}>
          Retry
        </Button>
      </Flex>
    );
  }

  return (
    <LocalMcpConfigEditor
      path={data?.path ?? "~/.posthog-code/mcp.json"}
      initialContent={data?.content ?? EMPTY_CONFIG}
    />
  );
}

function LocalMcpConfigEditor({
  path,
  initialContent,
}: {
  path: string;
  initialContent: string;
}) {
  const service = useService<LocalMcpImportService>(LOCAL_MCP_IMPORT_SERVICE);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [failedContent, setFailedContent] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const savedContentRef = useRef(savedContent);
  draftRef.current = draft;
  savedContentRef.current = savedContent;
  const validationError = validationMessage(draft);
  const statusIsDangerous = validationError !== null || failedContent === draft;
  const saveConfig = useMutation({
    mutationFn: (content: string) => service.updateConfigFile(content),
    retry: 1,
    onSuccess: (saved) => {
      const content = saved.content ?? EMPTY_CONFIG;
      setSavedContent(content);
      setFailedContent(null);
      queryClient.invalidateQueries({
        queryKey: ["local-mcp-cloud-availability"],
      });
    },
    onError: (error, content) => {
      setFailedContent(content);
      toast.error(error.message || "Failed to save local MCP configuration");
    },
  });

  useEffect(() => {
    if (
      draft === savedContent ||
      draft === failedContent ||
      saveConfig.isPending
    ) {
      return;
    }
    const timer = setTimeout(() => {
      saveConfig.mutate(draft);
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, failedContent, saveConfig, savedContent]);

  useEffect(
    () => () => {
      const latestDraft = draftRef.current;
      if (latestDraft === savedContentRef.current) return;
      void service.updateConfigFile(latestDraft).catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to save local MCP configuration",
        );
      });
    },
    [service],
  );

  return (
    <Flex direction="column" gap="3" className="h-full min-h-[600px]">
      <Flex align="center" justify="between">
        <Flex direction="column" gap="1">
          <Text className="font-medium">Local MCP configuration</Text>
          <Text color="gray" className="text-sm">
            {path}
          </Text>
          <Text color="gray" className="text-xs">
            Shared by local Claude and Codex agents. Supports stdio and HTTP.
          </Text>
        </Flex>
        <Text
          role="status"
          aria-live="polite"
          color={statusIsDangerous ? "red" : "gray"}
          className="font-medium text-xs"
        >
          {saveStatus(saveConfig.isPending, draft, savedContent, failedContent)}
        </Text>
        {failedContent === draft && (
          <Button
            variant="outline"
            color="red"
            size="1"
            onClick={() => saveConfig.mutate(draft)}
          >
            Retry
          </Button>
        )}
      </Flex>
      <Box className="min-h-0 flex-1 overflow-hidden rounded border border-gray-6">
        <SkillCodeEditor
          initialContent={initialContent}
          filePath={path}
          onDocChanged={(content) => {
            setDraft(content);
            setFailedContent(null);
          }}
        />
      </Box>
    </Flex>
  );
}
