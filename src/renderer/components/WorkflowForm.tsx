import { Cross2Icon } from "@radix-ui/react-icons";
import {
  AlertDialog,
  Button,
  Dialog,
  Flex,
  IconButton,
  TabNav,
} from "@radix-ui/themes";
import type { Workflow } from "@shared/types";
import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTabStore } from "../stores/tabStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { WorkflowBasicInfoStep } from "./workflow/WorkflowBasicInfoStep";
import {
  type StageFormData,
  WorkflowStagesStep,
} from "./workflow/WorkflowStagesStep";

interface WorkflowFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow?: Workflow | null;
}

const INITIAL_STAGES: StageFormData[] = [
  { id: "temp-0", name: "", agentId: null },
  { id: "temp-1", name: "Complete", agentId: null },
];

const generateKey = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, "_");

export function WorkflowForm({
  open,
  onOpenChange,
  workflow,
}: WorkflowFormProps) {
  const {
    createWorkflow,
    updateWorkflow,
    deactivateWorkflow,
    isLoading,
    agents,
    fetchAgents,
    selectWorkflow,
  } = useWorkflowStore();
  const { tabs, setActiveTab, createTab } = useTabStore();
  const [currentStep, setCurrentStep] = useState<"info" | "stages">("info");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stages, setStages] = useState<StageFormData[]>(INITIAL_STAGES);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isEditMode = !!workflow;

  useEffect(() => {
    if (open) {
      fetchAgents();
      if (workflow) {
        setName(workflow.name);
        setDescription(workflow.description || "");
        setStages(
          workflow.stages
            .filter((s) => !s.is_archived)
            .sort((a, b) => a.position - b.position)
            .map((s) => ({
              id: s.id,
              name: s.name,
              agentId: s.agent_name || null,
            })),
        );
      }
    }
  }, [open, fetchAgents, workflow]);

  const addStage = () => {
    const newStage: StageFormData = {
      id: `temp-${Date.now()}`,
      name: "",
      agentId: null,
    };
    // Insert before the last stage (Complete)
    setStages((prev) => [
      ...prev.slice(0, -1),
      newStage,
      prev[prev.length - 1],
    ]);
  };

  const removeStage = (index: number) => {
    // Can't remove last (Complete) stage
    if (index === stages.length - 1) return;
    setStages((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStage = (index: number, updates: Partial<StageFormData>) => {
    setStages((prev) =>
      prev.map((stage, i) => (i === index ? { ...stage, ...updates } : stage)),
    );
  };

  const resetForm = () => {
    setCurrentStep("info");
    setName("");
    setDescription("");
    setStages(INITIAL_STAGES);
  };

  const navigateToWorkflowTab = () => {
    const workflowTab = tabs.find((tab) => tab.type === "workflow");
    if (workflowTab) {
      setActiveTab(workflowTab.id);
    } else {
      createTab({ type: "workflow", title: "Workflows" });
    }
  };

  const handleDelete = async () => {
    if (!workflow) return;

    try {
      await deactivateWorkflow(workflow.id);
      setDeleteDialogOpen(false);
      resetForm();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete workflow:", error);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || stages.length < 2) return;

    try {
      const workflowStore = useWorkflowStore.getState();

      if (isEditMode && workflow) {
        await updateWorkflow(workflow.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        });

        const existingStageIds = new Set(workflow.stages.map((s) => s.id));

        for (let i = 0; i < stages.length; i++) {
          const stage = stages[i];
          const isComplete = i === stages.length - 1;
          const isExistingStage = existingStageIds.has(stage.id);

          if (isExistingStage) {
            await workflowStore.updateStage(workflow.id, stage.id, {
              name: stage.name,
              key: generateKey(stage.name),
              position: i,
              is_manual_only: isComplete || !stage.agentId,
              agent_name: isComplete ? null : stage.agentId,
            });
          } else {
            await workflowStore.createStage(workflow.id, {
              name: stage.name,
              key: generateKey(stage.name),
              position: i,
              is_manual_only: isComplete || !stage.agentId,
              agent_name: isComplete ? null : stage.agentId,
            });
          }
        }

        await workflowStore.fetchWorkflows({ skipLoadingState: true });
      } else {
        const newWorkflow = await createWorkflow({
          name: name.trim(),
          description: description.trim() || undefined,
        });

        for (let i = 0; i < stages.length; i++) {
          const stage = stages[i];
          const isComplete = i === stages.length - 1;

          await workflowStore.createStage(newWorkflow.id, {
            name: stage.name,
            key: generateKey(stage.name),
            position: i,
            is_manual_only: isComplete || !stage.agentId,
            agent_name: isComplete ? null : stage.agentId,
          });
        }

        selectWorkflow(newWorkflow.id);
        await workflowStore.fetchWorkflows({ skipLoadingState: true });
        navigateToWorkflowTab();
      }

      useWorkflowStore.setState({ isLoading: false });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      console.error(
        `Failed to ${isEditMode ? "update" : "create"} workflow:`,
        error,
      );
    }
  };

  useHotkeys("mod+enter", handleSubmit, {
    enabled: open,
    enableOnFormTags: true,
  });

  const canProceedToStages = name.trim().length > 0;
  const allStagesHaveNames = stages.every(
    (stage) => stage.name.trim().length > 0,
  );
  const canCreateWorkflow =
    canProceedToStages && allStagesHaveNames && stages.length >= 2;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        maxWidth="600px"
        maxHeight="80vh"
        aria-describedby={undefined}
      >
        <Flex direction="column" gap="4" height="100%">
          <Flex justify="between" align="center">
            <Dialog.Title className="mb-0" size="2">
              {isEditMode ? "Edit Workflow" : "New Workflow"}
            </Dialog.Title>
            <Dialog.Close>
              <IconButton size="1" variant="ghost" color="gray">
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

          <TabNav.Root>
            <TabNav.Link
              active={currentStep === "info"}
              onClick={() => setCurrentStep("info")}
            >
              General
            </TabNav.Link>
            <TabNav.Link
              active={currentStep === "stages"}
              onClick={() => canProceedToStages && setCurrentStep("stages")}
              style={{
                opacity: canProceedToStages ? 1 : 0.5,
                cursor: canProceedToStages ? "pointer" : "not-allowed",
              }}
            >
              Stages
            </TabNav.Link>
          </TabNav.Root>

          <Flex direction="column" gap="4" flexGrow="1" overflowY="auto">
            {currentStep === "info" && (
              <WorkflowBasicInfoStep
                name={name}
                description={description}
                onNameChange={setName}
                onDescriptionChange={setDescription}
              />
            )}

            {currentStep === "stages" && (
              <WorkflowStagesStep
                stages={stages}
                agents={agents}
                onAddStage={addStage}
                onRemoveStage={removeStage}
                onUpdateStageName={(index, name) =>
                  updateStage(index, { name })
                }
                onUpdateStageAgent={(index, agentId) =>
                  updateStage(index, { agentId })
                }
              />
            )}
          </Flex>

          <Flex gap="3" justify="between">
            <div>
              {isEditMode && (
                <AlertDialog.Root
                  open={deleteDialogOpen}
                  onOpenChange={setDeleteDialogOpen}
                >
                  <AlertDialog.Trigger>
                    <Button variant="soft" color="red">
                      Delete workflow
                    </Button>
                  </AlertDialog.Trigger>
                  <AlertDialog.Content
                    maxWidth="450px"
                    aria-describedby="alert-dialog-description"
                  >
                    <AlertDialog.Title>Delete Workflow</AlertDialog.Title>
                    <AlertDialog.Description
                      size="2"
                      id="alert-dialog-description"
                    >
                      Are you sure you want to delete this workflow?
                      <br /> This action cannot be undone.
                    </AlertDialog.Description>
                    <Flex gap="3" mt="4" justify="end">
                      <AlertDialog.Cancel>
                        <Button variant="soft" color="gray">
                          Cancel
                        </Button>
                      </AlertDialog.Cancel>
                      <AlertDialog.Action>
                        <Button
                          variant="solid"
                          color="red"
                          onClick={handleDelete}
                        >
                          Delete workflow
                        </Button>
                      </AlertDialog.Action>
                    </Flex>
                  </AlertDialog.Content>
                </AlertDialog.Root>
              )}
            </div>
            <Flex gap="3">
              <Button variant="soft" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {currentStep === "info" ? (
                <Button
                  variant="classic"
                  onClick={() => setCurrentStep("stages")}
                  disabled={!canProceedToStages}
                >
                  Next: Stages
                </Button>
              ) : (
                <Button
                  variant="classic"
                  onClick={handleSubmit}
                  disabled={!canCreateWorkflow}
                  loading={isLoading}
                >
                  {isEditMode ? "Update workflow" : "Create workflow"}
                </Button>
              )}
            </Flex>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
