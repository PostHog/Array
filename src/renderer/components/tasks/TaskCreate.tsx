import { GithubLogoIcon } from "@phosphor-icons/react";
import {
  Cross2Icon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Code,
  DataList,
  Dialog,
  Flex,
  IconButton,
  Switch,
  Text,
} from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { useRepositoryIntegration } from "../../hooks/useRepositoryIntegration";
import { useCreateTask } from "../../hooks/useTasks";
import { useAuthStore } from "../../stores/authStore";
import { useFolderPickerStore } from "../../stores/folderPickerStore";
import { useTabStore } from "../../stores/tabStore";
import { useTaskExecutionStore } from "../../stores/taskExecutionStore";
import {
  formatRepoKey,
  parseRepoKey,
  REPO_NOT_IN_INTEGRATION_WARNING,
} from "../../utils/repository";
import { Combobox } from "../Combobox";
import { FolderPicker } from "../FolderPicker";
import { RichTextEditor } from "../RichTextEditor";

interface TaskCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskCreate({ open, onOpenChange }: TaskCreateProps) {
  const { mutate: createTask, isPending: isLoading, error } = useCreateTask();
  const { createTab } = useTabStore();
  const { repositories, isRepoInIntegration } = useRepositoryIntegration();
  const { client, isAuthenticated } = useAuthStore();
  const { setRepoPath: saveRepoPath, setRepoWorkingDir } =
    useTaskExecutionStore();
  const { lastSelectedFolder, setLastSelectedFolder } = useFolderPickerStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [repoWarning, setRepoWarning] = useState<string | null>(null);

  const {
    handleSubmit,
    reset,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitted },
  } = useForm({
    defaultValues: {
      description: "",
      repository: "",
      folderPath: lastSelectedFolder || "",
    },
  });

  const folderPath = watch("folderPath");

  const detectRepoFromFolder = useCallback(
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
          setValue("repository", repoKey);

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
    [isRepoInIntegration, setValue],
  );

  useEffect(() => {
    if (folderPath) {
      detectRepoFromFolder(folderPath);
    }
  }, [folderPath, detectRepoFromFolder]);

  const onSubmit = (data: {
    description: string;
    repository: string;
    folderPath: string;
  }) => {
    if (!isAuthenticated || !client) {
      return;
    }

    if (!data.description.trim()) {
      return;
    }

    const repositoryConfig = data.repository
      ? (parseRepoKey(data.repository) ?? undefined)
      : undefined;

    createTask(
      {
        description: data.description,
        repositoryConfig,
      },
      {
        onSuccess: (newTask) => {
          // Save the local working directory to the task execution store
          if (data.folderPath && data.folderPath.trim().length > 0) {
            saveRepoPath(newTask.id, data.folderPath);
            setLastSelectedFolder(data.folderPath);

            // Also save the mapping for GitHub repos to reuse later
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
          reset();
          setRepoWarning(null);
          if (!createMore) {
            onOpenChange(false);
          }
        },
        onError: (error) => {
          console.error("Failed to create task:", error);
        },
      },
    );
  };

  useHotkeys(
    "mod+enter",
    (e) => {
      e.preventDefault();
      handleSubmit(onSubmit)();
    },
    {
      enabled: open,
      enableOnFormTags: true,
    },
  );

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setRepoWarning(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content
        maxHeight={isExpanded ? "90vh" : "600px"}
        height={isExpanded ? "90vh" : "auto"}
      >
        <Flex direction="column" height="100%">
          <Flex justify="between" align="center">
            <Dialog.Title className="mb-0" size="2">
              New Task
            </Dialog.Title>
            <Flex gap="2">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <ExitFullScreenIcon /> : <EnterFullScreenIcon />}
              </IconButton>
              <Dialog.Close>
                <IconButton size="1" variant="ghost" color="gray">
                  <Cross2Icon />
                </IconButton>
              </Dialog.Close>
            </Flex>
          </Flex>

          <form
            onSubmit={handleSubmit(onSubmit)}
            style={{ display: "contents" }}
          >
            <Flex direction="column" gap="4" mt="4" flexGrow="1">
              <Flex
                direction="column"
                gap="2"
                flexGrow="1"
                style={{ minHeight: 0 }}
              >
                <Controller
                  name="description"
                  control={control}
                  rules={{
                    required: true,
                    validate: (v) => v.trim().length > 0,
                  }}
                  render={({ field }) => (
                    <RichTextEditor
                      value={field.value}
                      onChange={field.onChange}
                      repoPath={folderPath}
                      placeholder="Add description... Use @ to mention files, or try **bold**, *italic*, `code`, and more!"
                      showToolbar={true}
                      minHeight={isExpanded ? "200px" : "120px"}
                      style={{
                        height: isExpanded ? "100%" : "auto",
                        overflow: isExpanded ? "auto" : "visible",
                      }}
                    />
                  )}
                />
              </Flex>

              {/* Configuration */}
              <DataList.Root>
                <DataList.Item>
                  <DataList.Label>Working Directory</DataList.Label>
                  <DataList.Value>
                    <Controller
                      name="folderPath"
                      control={control}
                      rules={{
                        required: true,
                        validate: (v) => v.trim().length > 0,
                      }}
                      render={({ field }) => (
                        <FolderPicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Choose working folder..."
                          size="1"
                        />
                      )}
                    />
                  </DataList.Value>
                </DataList.Item>

                {repositories.length > 0 && (
                  <DataList.Item>
                    <DataList.Label>Repository</DataList.Label>
                    <DataList.Value>
                      <Controller
                        name="repository"
                        control={control}
                        render={({ field }) => (
                          <Combobox
                            items={repositories.map((repo) => {
                              const repoKey = formatRepoKey(
                                repo.organization,
                                repo.repository,
                              );
                              return {
                                value: repoKey,
                                label: repoKey,
                              };
                            })}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Select GitHub repo..."
                            searchPlaceholder="Search repositories..."
                            emptyMessage="No repositories found"
                            size="1"
                            variant="outline"
                            icon={<GithubLogoIcon />}
                            side="top"
                          />
                        )}
                      />
                    </DataList.Value>
                  </DataList.Item>
                )}
              </DataList.Root>

              {repoWarning && (
                <Callout.Root color="blue" size="1">
                  <Callout.Text>
                    <Code size="2">{repoWarning}</Code>{" "}
                    {REPO_NOT_IN_INTEGRATION_WARNING}
                  </Callout.Text>
                </Callout.Root>
              )}

              {isSubmitted && (errors.description || errors.folderPath) && (
                <Callout.Root color="red" size="1">
                  <Callout.Text>
                    {errors.description && "Description is required. "}
                    {errors.folderPath && "Working directory is required."}
                  </Callout.Text>
                </Callout.Root>
              )}

              {error && (
                <Callout.Root color="red" size="1">
                  <Callout.Text>
                    Failed to create task:{" "}
                    {error instanceof Error ? error.message : "Unknown error"}
                  </Callout.Text>
                </Callout.Root>
              )}

              {!isAuthenticated && (
                <Callout.Root color="orange" size="1">
                  <Callout.Text>
                    Not authenticated - please check your connection
                  </Callout.Text>
                </Callout.Root>
              )}

              <Flex gap="3" justify="end" align="end">
                <Text as="label" size="1" style={{ cursor: "pointer" }}>
                  <Flex gap="2" align="center" mb="2">
                    <Switch
                      checked={createMore}
                      onCheckedChange={setCreateMore}
                      size="1"
                    />
                    <Text size="1" color="gray" className="select-none">
                      Create more
                    </Text>
                  </Flex>
                </Text>
                <Button
                  type="submit"
                  variant="classic"
                  disabled={isLoading || !isAuthenticated}
                >
                  {isLoading ? "Creating..." : "Create task"}
                </Button>
              </Flex>
            </Flex>
          </form>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
