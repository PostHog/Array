import { useCallback, useMemo, useState } from "react";
import {
  type SubmitHandler,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { useRepositoryIntegration } from "../../hooks/useRepositoryIntegration";
import { useCreateTask } from "../../hooks/useTasks";
import { useWorkflows } from "../../hooks/useWorkflows";
import { useAuthStore } from "../../stores/authStore";
import { useTabStore } from "../../stores/tabStore";
import { useTaskExecutionStore } from "../../stores/taskExecutionStore";
import {
  formatRepoKey,
  parseRepoKey,
  REPO_NOT_IN_INTEGRATION_WARNING,
} from "../../utils/repository";

export interface TaskCreateFormValues {
  title: string;
  description: string;
  repository: string;
  workflow: string;
  folderPath: string;
}

interface UseTaskCreateControllerParams {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UseTaskCreateControllerReturn {
  form: UseFormReturn<TaskCreateFormValues>;
  workflowOptions: Array<{ value: string; label: string }>;
  repositoryOptions: Array<{ value: string; label: string }>;
  isExpanded: boolean;
  toggleExpanded: () => void;
  createMore: boolean;
  setCreateMore: (value: boolean) => void;
  repoWarning: string | null;
  repoWarningMessage: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: unknown;
  handleSubmit: ReturnType<UseFormReturn<TaskCreateFormValues>["handleSubmit"]>;
  handleDialogOpenChange: (open: boolean) => void;
  handleFolderPathChange: (value: string) => Promise<void>;
  repositoriesAvailable: boolean;
}

export function useTaskCreateController({
  open,
  onOpenChange,
}: UseTaskCreateControllerParams): UseTaskCreateControllerReturn {
  const { mutate: createTask, isPending: isLoading, error } = useCreateTask();
  const { createTab } = useTabStore();
  const { repositories, isRepoInIntegration } = useRepositoryIntegration();
  const { data: workflows = [] } = useWorkflows();
  const { client, isAuthenticated } = useAuthStore();
  const { setRepoPath, setRepoWorkingDir } = useTaskExecutionStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [repoWarning, setRepoWarning] = useState<string | null>(null);

  const defaultWorkflow = useMemo(
    () =>
      workflows.find((workflow) => workflow.is_active && workflow.is_default) ??
      workflows[0],
    [workflows],
  );

  const workflowOptions = useMemo(
    () =>
      workflows.map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
      })),
    [workflows],
  );

  const repositoryOptions = useMemo(
    () =>
      repositories.map((repo) => {
        const repoKey = formatRepoKey(repo.organization, repo.repository);
        return {
          value: repoKey,
          label: repoKey,
        };
      }),
    [repositories],
  );

  const form = useForm<TaskCreateFormValues>({
    defaultValues: {
      title: "",
      description: "",
      repository: "",
      workflow: defaultWorkflow?.id ?? "",
      folderPath: "",
    },
  });

  const resetForm = useCallback(() => {
    form.reset({
      title: "",
      description: "",
      repository: "",
      workflow: defaultWorkflow?.id ?? "",
      folderPath: "",
    });
  }, [form, defaultWorkflow]);

  const handleDetection = useCallback(
    async (newPath: string) => {
      if (!newPath?.trim()) {
        setRepoWarning(null);
        return;
      }

      try {
        const repoInfo = await window.electronAPI?.detectRepo(newPath);
        if (repoInfo) {
          const repoKey = formatRepoKey(
            repoInfo.organization,
            repoInfo.repository,
          );
          form.setValue("repository", repoKey);

          if (!isRepoInIntegration(repoKey)) {
            setRepoWarning(repoKey);
          } else {
            setRepoWarning(null);
          }
        } else {
          setRepoWarning(null);
        }
      } catch {
        setRepoWarning(null);
      }
    },
    [form, isRepoInIntegration],
  );

  const onSubmit: SubmitHandler<TaskCreateFormValues> = useCallback(
    (data) => {
      if (!isAuthenticated || !client) {
        return;
      }

      const trimmedTitle = data.title.trim();
      const trimmedDescription = data.description.trim();

      if (!trimmedTitle || !trimmedDescription) {
        return;
      }

      const repositoryConfig = data.repository
        ? (parseRepoKey(data.repository) ?? undefined)
        : undefined;

      createTask(
        {
          title: trimmedTitle,
          description: trimmedDescription,
          repositoryConfig,
          workflow: data.workflow || "",
        },
        {
          onSuccess: (newTask) => {
            if (data.folderPath && data.folderPath.trim().length > 0) {
              setRepoPath(newTask.id, data.folderPath);
              if (repositoryConfig) {
                const repoKey = `${repositoryConfig.organization}/${repositoryConfig.repository}`;
                setRepoWorkingDir(repoKey, data.folderPath);
              }
            }

            createTab({
              type: "task-detail",
              title: newTask.title,
              data: newTask,
            });

            resetForm();
            setRepoWarning(null);

            if (!createMore) {
              onOpenChange(false);
            }
          },
          onError: (err) => {
            console.error("Failed to create task:", err);
          },
        },
      );
    },
    [
      client,
      createTask,
      createTab,
      createMore,
      isAuthenticated,
      onOpenChange,
      resetForm,
      setRepoPath,
      setRepoWorkingDir,
    ],
  );

  const handleSubmit = form.handleSubmit(onSubmit);

  useHotkeys(
    "mod+enter",
    (event) => {
      if (!open) return;
      event.preventDefault();
      handleSubmit();
    },
    {
      enableOnFormTags: true,
      enabled: open,
    },
  );

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleDialogOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setRepoWarning(null);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange],
  );

  return {
    form,
    workflowOptions,
    repositoryOptions,
    isExpanded,
    toggleExpanded,
    createMore,
    setCreateMore,
    repoWarning,
    repoWarningMessage: REPO_NOT_IN_INTEGRATION_WARNING,
    isLoading,
    isAuthenticated,
    error,
    handleSubmit,
    handleDialogOpenChange,
    handleFolderPathChange: handleDetection,
    repositoriesAvailable: repositories.length > 0,
  };
}
