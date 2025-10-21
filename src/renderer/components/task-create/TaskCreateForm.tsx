import { DiamondIcon, GithubLogoIcon } from "@phosphor-icons/react";
import {
  Button,
  Callout,
  Code,
  DataList,
  Flex,
  Switch,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Combobox } from "../Combobox";
import { FolderPicker } from "../FolderPicker";
import { RichTextEditor } from "../RichTextEditor";
import type { TaskCreateFormValues } from "./useTaskCreateController";

interface TaskCreateFormProps {
  form: UseFormReturn<TaskCreateFormValues>;
  workflowOptions: Array<{ value: string; label: string }>;
  repositoryOptions: Array<{ value: string; label: string }>;
  isExpanded: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  createMore: boolean;
  setCreateMore: (value: boolean) => void;
  repoWarning: string | null;
  repoWarningMessage: string;
  error: unknown;
  handleSubmit: ReturnType<UseFormReturn<TaskCreateFormValues>["handleSubmit"]>;
  handleFolderPathChange: (value: string) => Promise<void>;
  repositoriesAvailable: boolean;
}

export function TaskCreateForm({
  form,
  workflowOptions,
  repositoryOptions,
  isExpanded,
  isLoading,
  isAuthenticated,
  createMore,
  setCreateMore,
  repoWarning,
  repoWarningMessage,
  error,
  handleSubmit,
  handleFolderPathChange,
  repositoriesAvailable,
}: TaskCreateFormProps) {
  const {
    control,
    register,
    watch,
    formState: { errors, isSubmitted },
  } = form;

  const folderPath = watch("folderPath");
  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;

  return (
    <form onSubmit={handleSubmit} style={{ display: "contents" }}>
      <Flex direction="column" gap="4" mt="4" flexGrow="1">
        <Flex direction="column" gap="2">
          <TextArea
            {...register("title", {
              required: true,
              validate: (value) => value.trim().length > 0,
            })}
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

        <Flex direction="column" gap="2" flexGrow="1" style={{ minHeight: 0 }}>
          <Controller
            name="description"
            control={control}
            rules={{
              required: true,
              validate: (value) => value.trim().length > 0,
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

        <DataList.Root>
          <DataList.Item>
            <DataList.Label>Working Directory</DataList.Label>
            <DataList.Value>
              <Controller
                name="folderPath"
                control={control}
                rules={{
                  required: true,
                  validate: (value) => value.trim().length > 0,
                }}
                render={({ field }) => (
                  <FolderPicker
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      void handleFolderPathChange(value);
                    }}
                    placeholder="Choose working folder..."
                    size="1"
                  />
                )}
              />
            </DataList.Value>
          </DataList.Item>

          {workflowOptions.length > 0 && (
            <DataList.Item>
              <DataList.Label>Workflow</DataList.Label>
              <DataList.Value>
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
                      size="1"
                      variant="outline"
                      icon={<DiamondIcon />}
                      side="top"
                    />
                  )}
                />
              </DataList.Value>
            </DataList.Item>
          )}

          {repositoriesAvailable && (
            <DataList.Item>
              <DataList.Label>Repository</DataList.Label>
              <DataList.Value>
                <Controller
                  name="repository"
                  control={control}
                  render={({ field }) => (
                    <Combobox
                      items={repositoryOptions}
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
              <Code size="2">{repoWarning}</Code> {repoWarningMessage}
            </Callout.Text>
          </Callout.Root>
        )}

        {isSubmitted &&
          (errors.title ||
            errors.description ||
            errors.workflow ||
            errors.folderPath) && (
            <Callout.Root color="red" size="1">
              <Callout.Text>
                {errors.title && "Title is required. "}
                {errors.description && "Description is required. "}
                {errors.workflow && "Workflow is required. "}
                {errors.folderPath && "Working directory is required."}
              </Callout.Text>
            </Callout.Root>
          )}

        {errorMessage && (
          <Callout.Root color="red" size="1">
            <Callout.Text>Failed to create task: {errorMessage}</Callout.Text>
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
  );
}
