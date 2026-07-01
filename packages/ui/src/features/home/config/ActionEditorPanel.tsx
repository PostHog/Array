import { ArrowDown, ArrowUp, Trash, X } from "@phosphor-icons/react";
import {
  SITUATIONS,
  type SituationId,
  type WorkflowAction,
} from "@posthog/core/workflow/schemas";
import { Button } from "@posthog/quill";
import { useSkillsForPicker } from "@posthog/ui/features/home/hooks/useSkillsForPicker";
import { useWorkflowEditorStore } from "@posthog/ui/features/home/stores/workflowEditorStore";
import { UnifiedModelSelector } from "@posthog/ui/features/sessions/components/UnifiedModelSelector";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { usePreviewConfig } from "@posthog/ui/features/task-detail/hooks/usePreviewConfig";
import { Combobox } from "@posthog/ui/primitives/combobox/Combobox";
import type { ComboboxSearchKeys } from "@posthog/ui/primitives/combobox/useComboboxFilter";
import { Card, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { useMemo } from "react";
import { SITUATION_TONE } from "./workflowMapLayout";

interface Props {
  situationId: SituationId;
  action: WorkflowAction;
  totalInSituation: number;
  indexInSituation: number;
}

type SkillOption = ReturnType<typeof useSkillsForPicker>["skills"][number];

// Name-first so a prefix match on the name wins the exact-match promotion.
const skillSearchValue = (s: SkillOption) => `${s.name} ${s.description}`;

// Weight the skill name above its description so a name hit ranks first.
const SKILL_SEARCH_KEYS: ComboboxSearchKeys<SkillOption> = [
  { name: "name", weight: 0.7 },
  { name: "description", weight: 0.3 },
];

export function ActionEditorPanel({
  situationId,
  action,
  totalInSituation,
  indexInSituation,
}: Props) {
  const updateAction = useWorkflowEditorStore((s) => s.updateAction);
  const removeAction = useWorkflowEditorStore((s) => s.removeAction);
  const moveAction = useWorkflowEditorStore((s) => s.moveAction);
  const selectSituation = useWorkflowEditorStore((s) => s.selectSituation);

  const { skills, isLoading } = useSkillsForPicker();
  const selectedSkill = skills.find((s) => s.name === action.skillId) ?? null;

  const lastUsedAdapter = useSettingsStore((s) => s.lastUsedAdapter);
  const adapterForModel = action.adapter ?? lastUsedAdapter;
  const { modelOption, isLoading: modelLoading } =
    usePreviewConfig(adapterForModel);
  // Show the action's pinned model in the picker, else the adapter's default.
  const effectiveModelOption = useMemo(() => {
    if (!modelOption || modelOption.type !== "select" || !action.model) {
      return modelOption;
    }
    return { ...modelOption, currentValue: action.model };
  }, [modelOption, action.model]);

  const meta = SITUATIONS.find((s) => s.id === situationId);
  const tone = SITUATION_TONE[situationId];

  function patch(p: Partial<WorkflowAction>) {
    updateAction(situationId, action.id, p);
  }

  function handleRemove() {
    removeAction(situationId, action.id);
    // Fall back to the situation overview so the user keeps context.
    selectSituation(situationId);
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
          <Text className="text-[11px] text-gray-11">Edit action</Text>
        </Flex>
        <Button
          size="xs"
          variant="link-muted"
          onClick={() => selectSituation(situationId)}
          title="Back to situation"
        >
          <X size={12} />
        </Button>
      </Flex>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <Card variant="surface" className="flex flex-col gap-3 p-3">
          <Field label="Button label">
            <TextField.Root
              size="2"
              value={action.label}
              autoFocus
              placeholder="What the button on the row says"
              onChange={(e) => patch({ label: e.target.value })}
            />
          </Field>

          <Field label="Skill">
            <Combobox.Root
              value={action.skillId}
              onValueChange={(v) => patch({ skillId: v })}
              size="2"
            >
              <Combobox.Trigger
                className="w-full"
                placeholder={isLoading ? "Loading…" : "Pick a skill"}
              >
                {selectedSkill?.name}
              </Combobox.Trigger>
              <Combobox.Content
                items={skills}
                getValue={skillSearchValue}
                searchKeys={SKILL_SEARCH_KEYS}
                className="w-(--radix-popover-trigger-width)"
              >
                {({ filtered, hasMore, moreCount }) => (
                  <>
                    <Combobox.Input placeholder="Search skills..." />
                    <Combobox.Empty>
                      {isLoading ? "Loading skills…" : "No matching skills"}
                    </Combobox.Empty>
                    {filtered.map((s) => (
                      <Combobox.Item
                        key={s.name}
                        value={s.name}
                        textValue={s.name}
                        description={s.description}
                      >
                        {s.name}
                      </Combobox.Item>
                    ))}
                    {hasMore && (
                      <Combobox.Label>
                        {moreCount} more; type to filter
                      </Combobox.Label>
                    )}
                  </>
                )}
              </Combobox.Content>
            </Combobox.Root>
            {selectedSkill ? (
              <Text className="mt-1 text-[10px] text-gray-10">
                {selectedSkill.description}
              </Text>
            ) : null}
          </Field>

          <Field label="Prompt">
            <TextArea
              size="2"
              value={action.prompt}
              placeholder="Prompt to send to the agent. It already has access to the current branch, PR, and repo."
              rows={6}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </Field>

          <Field label="Model">
            <div className="self-start">
              <UnifiedModelSelector
                modelOption={effectiveModelOption}
                adapter={adapterForModel}
                onAdapterChange={(a) => patch({ adapter: a, model: undefined })}
                onModelChange={(m) =>
                  patch({ model: m, adapter: adapterForModel })
                }
                isConnecting={modelLoading}
              />
            </div>
            {action.model ? null : (
              <Text className="mt-1 text-[10px] text-gray-10">
                Runs on your default model unless you pick one.
              </Text>
            )}
          </Field>
        </Card>

        <Flex justify="between" align="center" className="mt-3">
          <Flex gap="1">
            <Button
              size="xs"
              variant="link-muted"
              onClick={() => moveAction(situationId, action.id, "up")}
              disabled={indexInSituation === 0}
              title="Move up (button order on row)"
            >
              <ArrowUp size={11} />
            </Button>
            <Button
              size="xs"
              variant="link-muted"
              onClick={() => moveAction(situationId, action.id, "down")}
              disabled={indexInSituation === totalInSituation - 1}
              title="Move down"
            >
              <ArrowDown size={11} />
            </Button>
            <Text className="ml-1 self-center text-[10px] text-gray-10">
              {indexInSituation + 1} of {totalInSituation}
            </Text>
          </Flex>
          <Button
            size="xs"
            variant="link-muted"
            onClick={handleRemove}
            title="Delete action"
          >
            <Trash size={11} />
            Delete
          </Button>
        </Flex>
      </div>
    </Flex>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Text className="text-[10px] text-gray-11 uppercase tracking-wider">
        {label}
      </Text>
      {children}
    </div>
  );
}
