import { Plus, Sparkle, Trash, X } from "@phosphor-icons/react";
import {
  SITUATIONS,
  type SituationId,
  type WorkflowAction,
} from "@posthog/core/workflow/schemas";
import { Button } from "@posthog/quill";
import { useWorkflowEditorStore } from "@posthog/ui/features/home/stores/workflowEditorStore";
import { Flex, Text } from "@radix-ui/themes";
import { createDefaultAction } from "./freshActionId";
import { SITUATION_TONE } from "./workflowMapLayout";

interface Props {
  situationId: SituationId;
  actions: WorkflowAction[];
}

export function SituationOverviewPanel({ situationId, actions }: Props) {
  const addAction = useWorkflowEditorStore((s) => s.addAction);
  const removeAction = useWorkflowEditorStore((s) => s.removeAction);
  const selectAction = useWorkflowEditorStore((s) => s.selectAction);
  const clearSelection = useWorkflowEditorStore((s) => s.clearSelection);

  const meta = SITUATIONS.find((s) => s.id === situationId);
  const tone = SITUATION_TONE[situationId];

  function handleAdd() {
    const action = createDefaultAction(actions.map((a) => a.id));
    addAction(situationId, action);
    selectAction({
      kind: "action",
      situationId,
      actionId: action.id,
    });
  }

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        align="center"
        justify="between"
        gap="2"
        className={`border-(--gray-4) border-b px-4 py-2.5 ${tone.bg}`}
      >
        <Flex direction="column" gap="0">
          <Text
            className={`font-semibold text-[10px] uppercase tracking-wider ${tone.label}`}
          >
            {meta?.label}
          </Text>
          <Text className="text-[11px] text-gray-11">
            {actions.length} action{actions.length === 1 ? "" : "s"} bound
          </Text>
        </Flex>
        <Button
          size="xs"
          variant="link-muted"
          onClick={() => clearSelection()}
          title="Close"
        >
          <X size={12} />
        </Button>
      </Flex>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <Text className="text-[11px] text-gray-11">{meta?.description}</Text>
        <Text className="mt-2 block font-mono text-[10px] text-gray-9">
          {situationId}
        </Text>

        <Flex direction="column" gap="2" className="mt-4">
          {actions.length === 0 ? (
            <Text className="text-[11px] text-gray-10">
              Nothing bound yet. Add a skill to surface a quick-action button on
              the workstream row when work lands here.
            </Text>
          ) : (
            actions.map((action) => {
              const incomplete = action.prompt.trim() === "";
              return (
                <Flex
                  key={action.id}
                  align="center"
                  justify="between"
                  gap="2"
                  className={`rounded-md border bg-(--gray-1) px-2.5 py-2 ${
                    incomplete
                      ? "border-(--amber-7)"
                      : "border-(--gray-5) hover:border-(--gray-7)"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      selectAction({
                        kind: "action",
                        situationId,
                        actionId: action.id,
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Sparkle
                      size={11}
                      className={
                        incomplete ? "text-(--amber-11)" : "text-(--accent-11)"
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <Text className="truncate font-medium text-[12px] text-gray-12">
                        {action.label || "(no label)"}
                      </Text>
                      <Text className="block truncate text-[10px] text-gray-10">
                        {action.skillId || "(no skill)"}
                      </Text>
                    </div>
                  </button>
                  <Button
                    size="xs"
                    variant="link-muted"
                    onClick={() => removeAction(situationId, action.id)}
                    title="Remove"
                  >
                    <Trash size={11} />
                  </Button>
                </Flex>
              );
            })
          )}
        </Flex>

        <Button
          size="xs"
          variant="outline"
          onClick={handleAdd}
          className="mt-3 w-full"
        >
          <Plus size={11} />
          Add action
        </Button>
      </div>
    </Flex>
  );
}
