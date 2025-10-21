import {
  Cross2Icon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
} from "@radix-ui/react-icons";
import { Dialog, Flex, IconButton } from "@radix-ui/themes";
import { TaskCreateForm } from "./task-create/TaskCreateForm";
import { useTaskCreateController } from "./task-create/useTaskCreateController";

interface TaskCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskCreate({ open, onOpenChange }: TaskCreateProps) {
  const controller = useTaskCreateController({ open, onOpenChange });

  return (
    <Dialog.Root open={open} onOpenChange={controller.handleDialogOpenChange}>
      <Dialog.Content
        maxHeight={controller.isExpanded ? "90vh" : "600px"}
        height={controller.isExpanded ? "90vh" : "auto"}
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
                onClick={controller.toggleExpanded}
              >
                {controller.isExpanded ? (
                  <ExitFullScreenIcon />
                ) : (
                  <EnterFullScreenIcon />
                )}
              </IconButton>
              <Dialog.Close>
                <IconButton size="1" variant="ghost" color="gray">
                  <Cross2Icon />
                </IconButton>
              </Dialog.Close>
            </Flex>
          </Flex>

          <TaskCreateForm
            form={controller.form}
            workflowOptions={controller.workflowOptions}
            repositoryOptions={controller.repositoryOptions}
            isExpanded={controller.isExpanded}
            isLoading={controller.isLoading}
            isAuthenticated={controller.isAuthenticated}
            createMore={controller.createMore}
            setCreateMore={controller.setCreateMore}
            repoWarning={controller.repoWarning}
            repoWarningMessage={controller.repoWarningMessage}
            error={controller.error}
            handleSubmit={controller.handleSubmit}
            handleFolderPathChange={controller.handleFolderPathChange}
            repositoriesAvailable={controller.repositoriesAvailable}
          />
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
