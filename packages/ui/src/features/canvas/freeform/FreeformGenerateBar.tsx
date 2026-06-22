import { SparkleIcon } from "@phosphor-icons/react";
import {
  type GenerateCanvasTarget,
  useGenerateFreeformCanvas,
} from "@posthog/ui/features/canvas/hooks/useGenerateFreeformCanvas";
import { FolderPicker } from "@posthog/ui/features/folder-picker/FolderPicker";
import { GitHubRepoPicker } from "@posthog/ui/features/folder-picker/GitHubRepoPicker";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import {
  Button,
  Flex,
  SegmentedControl,
  Spinner,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useState } from "react";

type GenMode = "local" | "cloud";

// Composer that kicks off freeform canvas generation as a dedicated task: the
// user describes what they want, picks a local repo or a connected GitHub repo
// (cloud), and the agent builds + publishes the canvas. Used both for the first
// build (empty canvas) and for follow-up edits (currentCode passed in).
export function FreeformGenerateBar({
  dashboardId,
  channelId,
  channelName,
  name,
  templateId,
  currentCode,
  value,
  onValueChange,
  onStarted,
}: {
  dashboardId: string;
  channelId: string;
  channelName: string;
  name: string;
  templateId?: string;
  currentCode?: string;
  // Controlled draft text (so a self-repair action can prefill it).
  value: string;
  onValueChange: (next: string) => void;
  onStarted?: (taskId: string) => void;
}) {
  const { generate, isStarting } = useGenerateFreeformCanvas({
    dashboardId,
    channelId,
    name,
    channelName,
    templateId,
  });
  const lastUsedRunMode = useSettingsStore((s) => s.lastUsedRunMode);
  const draft = value;
  const setDraft = onValueChange;
  const [genMode, setGenMode] = useState<GenMode>(
    lastUsedRunMode === "cloud" ? "cloud" : "local",
  );
  const isEdit = !!currentCode?.trim();

  const run = async (target: GenerateCanvasTarget) => {
    const instruction = draft.trim();
    if (!instruction) return;
    const taskId = await generate(target, { instruction, currentCode });
    if (taskId) {
      setDraft("");
      onStarted?.(taskId);
    }
  };

  return (
    <Flex
      direction="column"
      gap="2"
      className="mx-auto w-full max-w-[480px] rounded-lg border border-gray-6 bg-gray-2 p-3"
    >
      <TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          isEdit
            ? "Describe the change you want…"
            : "Describe the canvas you want. The agent builds a React app from your PostHog data."
        }
        rows={3}
        disabled={isStarting}
      />
      <SegmentedControl.Root
        size="1"
        value={genMode}
        onValueChange={(v) => setGenMode(v as GenMode)}
      >
        <SegmentedControl.Item value="local">Local</SegmentedControl.Item>
        <SegmentedControl.Item value="cloud">Cloud</SegmentedControl.Item>
      </SegmentedControl.Root>
      {genMode === "local" ? (
        <GenerateLocal
          run={run}
          isStarting={isStarting}
          disabled={!draft.trim()}
          label={isEdit ? "Edit" : "Generate"}
        />
      ) : (
        <GenerateCloud
          run={run}
          isStarting={isStarting}
          disabled={!draft.trim()}
          label={isEdit ? "Edit" : "Generate"}
        />
      )}
    </Flex>
  );
}

interface SubProps {
  run: (target: GenerateCanvasTarget) => void;
  isStarting: boolean;
  disabled: boolean;
  label: string;
}

function GenerateLocal({ run, isStarting, disabled, label }: SubProps) {
  const [repoPath, setRepoPath] = useState("");
  return (
    <Flex align="center" gap="2">
      <FolderPicker value={repoPath} onChange={setRepoPath} />
      <Button
        size="2"
        variant="solid"
        disabled={!repoPath || disabled || isStarting}
        onClick={() => {
          if (repoPath) run({ mode: "local", repoPath });
        }}
      >
        {isStarting ? <Spinner size="1" /> : <SparkleIcon size={14} />}
        {label}
      </Button>
    </Flex>
  );
}

function GenerateCloud({ run, isStarting, disabled, label }: SubProps) {
  const {
    repositories,
    getUserIntegrationIdForRepo,
    isLoadingRepos,
    hasGithubIntegration,
  } = useUserRepositoryIntegration();
  const lastUsedCloudRepository = useSettingsStore(
    (s) => s.lastUsedCloudRepository,
  );
  const [repo, setRepo] = useState<string | null>(
    lastUsedCloudRepository ?? null,
  );
  const integrationId = repo ? getUserIntegrationIdForRepo(repo) : undefined;

  if (!hasGithubIntegration && !isLoadingRepos) {
    return (
      <Text className="text-[12px] text-gray-10">
        Connect GitHub to generate in the cloud.
      </Text>
    );
  }

  return (
    <Flex align="center" gap="2">
      <GitHubRepoPicker
        value={repo}
        onChange={setRepo}
        repositories={repositories}
        isLoading={isLoadingRepos}
        size="2"
      />
      <Button
        size="2"
        variant="solid"
        disabled={!repo || !integrationId || disabled || isStarting}
        onClick={() => {
          if (repo && integrationId) {
            run({
              mode: "cloud",
              repository: repo,
              githubUserIntegrationId: integrationId,
            });
          }
        }}
      >
        {isStarting ? <Spinner size="1" /> : <SparkleIcon size={14} />}
        {label}
      </Button>
    </Flex>
  );
}
