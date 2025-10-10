import {
  Cross2Icon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Switch,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { useIntegrations, useRepositories } from "../hooks/useIntegrations";
import { useCreateTask } from "../hooks/useTasks";
import { useWorkflows } from "../hooks/useWorkflows";
import { useTabStore } from "../stores/tabStore";
import { Combobox } from "./Combobox";

interface TaskCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskCreate({ open, onOpenChange }: TaskCreateProps) {
  const { mutate: createTask, isPending: isLoading } = useCreateTask();
  const { createTab } = useTabStore();
  const { data: integrations = [] } = useIntegrations();
  const { data: workflows = [] } = useWorkflows();

  const githubIntegration = useMemo(
    () => integrations.find((i) => i.kind === "github"),
    [integrations],
  );

  const { data: repositories = [] } = useRepositories(githubIntegration?.id);
  const [isExpanded, setIsExpanded] = useState(false);
  const [createMore, setCreateMore] = useState(false);

  const defaultWorkflow = useMemo(
    () => workflows.find((w) => w.is_active && w.is_default) || workflows[0],
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

  const { register, handleSubmit, reset, control } = useForm({
    defaultValues: {
      title: "",
      description: "",
      repository: "",
      workflow: defaultWorkflow?.id || "",
    },
  });

  const onSubmit = (data: {
    title: string;
    description: string;
    repository: string;
    workflow: string;
  }) => {
    if (!data.title.trim() || !data.description.trim() || !data.workflow) return;

    let repositoryConfig:
      | { organization: string; repository: string }
      | undefined;

    if (data.repository) {
      const [organization, repository] = data.repository.split("/");
      if (organization && repository) {
        repositoryConfig = { organization, repository };
      }
    }

    createTask(
      { title: data.title, description: data.description, repositoryConfig, workflow: data.workflow },
      {
        onSuccess: (newTask) => {
          createTab({
            type: "task-detail",
            title: newTask.title,
            data: newTask,
          });
          reset();
          if (!createMore) {
            onOpenChange(false);
          }
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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

          <form onSubmit={handleSubmit(onSubmit)} style={{ display: "contents" }}>
            <Flex direction="column" gap="4" mt="4" flexGrow="1">
              <Flex direction="column" gap="2">
                <TextArea
                  {...register("title", { required: true, validate: (v) => v.trim().length > 0 })}
                  placeholder="Task title..."
                  size="3"
                  autoFocus
                  rows={1}
                  style={{
                    resize: "none",
                    overflow: "hidden",
                    minHeight: "auto",
                  }}
                />
              </Flex>

            <Flex
              direction="column"
              gap="2"
              flexGrow="1"
              style={{ minHeight: 0 }}
            >
              <TextArea
                {...register("description", { required: true, validate: (v) => v.trim().length > 0 })}
                placeholder="Add description..."
                size="3"
                rows={3}
                style={{
                  resize: "none",
                  overflow: isExpanded ? "auto" : "hidden",
                  minHeight: "auto",
                  height: isExpanded ? "100%" : "auto",
                }}
              />
            </Flex>

            <Flex direction="column" gap="2" width="50%">
              {workflowOptions.length > 0 && (
                <Controller
                  name="workflow"
                  control={control}
                  rules={{ required: true }}
                  render={({ field }) => (
                    <Combobox
                      items={workflowOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select a workflow..."
                      searchPlaceholder="Search workflows..."
                      emptyMessage="No workflows found"
                      size="2"
                      side="top"
                    />
                  )}
                />
              )}
            </Flex>

            {repositories.length > 0 && (
              <Flex direction="column" gap="2" width="50%">
                <Controller
                  name="repository"
                  control={control}
                  render={({ field }) => (
                    <Combobox
                      items={repositories.map((repo) => ({
                        value: `${repo.organization}/${repo.repository}`,
                        label: `${repo.organization}/${repo.repository}`,
                      }))}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select a repository..."
                      searchPlaceholder="Search repositories..."
                      emptyMessage="No repositories found"
                      size="2"
                      side="top"
                    />
                  )}
                />
              </Flex>
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
                disabled={isLoading}
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
