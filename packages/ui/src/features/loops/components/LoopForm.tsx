import type { LoopSchemas } from "@posthog/api-client/loops";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { toast } from "@posthog/ui/primitives/toast";
import {
  navigateToLoopDetail,
  navigateToLoops,
} from "@posthog/ui/router/navigationBridge";
import { Box, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { type ReactNode, useState } from "react";
import { useAuthStateValue } from "../../auth/store";
import { useCreateLoop, useUpdateLoop } from "../hooks/useLoopMutations";
import {
  emptyLoopFormValues,
  formValuesToLoopWrite,
  isLoopFormValid,
  type LoopFormValues,
  loopToFormValues,
} from "../loopFormTypes";
import { LoopModelFields } from "./LoopModelFields";
import { LoopNotificationsFields } from "./LoopNotificationsFields";
import { LoopRepositoryPicker } from "./LoopRepositoryPicker";
import { LoopTriggerEditor } from "./LoopTriggerEditor";

const VISIBILITY_OPTIONS: {
  value: LoopSchemas.LoopVisibilityEnum;
  label: string;
}[] = [
  { value: "personal", label: "Personal — only you" },
  { value: "team", label: "Team — everyone on the project" },
];

interface LoopFormProps {
  /** Present in edit mode; absent when creating a new loop. */
  loop?: LoopSchemas.Loop;
}

export function LoopForm({ loop }: LoopFormProps) {
  const isEdit = !!loop;
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const [values, setValues] = useState<LoopFormValues>(() =>
    loop ? loopToFormValues(loop) : emptyLoopFormValues(),
  );

  const createLoop = useCreateLoop();
  const updateLoop = useUpdateLoop(loop?.id ?? "");
  const isSubmitting = isEdit ? updateLoop.isPending : createLoop.isPending;
  const canSubmit = isLoopFormValid(values) && !isSubmitting;

  useSetHeaderContent(
    <Text className="font-medium text-[13px]">
      {isEdit ? `Edit ${loop.name}` : "New loop"}
    </Text>,
  );

  const triggerEndpointPath =
    isEdit && projectId != null
      ? `/api/projects/${projectId}/loops/${loop.id}/trigger/`
      : null;

  const handleCancel = () => {
    if (isEdit) {
      navigateToLoopDetail(loop.id);
    } else {
      navigateToLoops();
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const body = formValuesToLoopWrite(values);
    try {
      if (isEdit) {
        const updated = await updateLoop.mutateAsync(body);
        navigateToLoopDetail(updated.id);
      } else {
        const created = await createLoop.mutateAsync(body);
        navigateToLoopDetail(created.id);
      }
    } catch (error) {
      toast.error(isEdit ? "Failed to save loop" : "Failed to create loop", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <Box className="mx-auto max-w-2xl px-6 py-6">
      <Flex direction="column" gap="6">
        <FormSection title="Basics">
          <Flex direction="column" gap="1">
            <Text className="text-[12px] text-gray-10">Name</Text>
            <TextField.Root
              size="2"
              value={values.name}
              placeholder="Daily standup summary"
              disabled={isSubmitting}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </Flex>

          <Flex direction="column" gap="1">
            <Text className="text-[12px] text-gray-10">
              Description (optional)
            </Text>
            <TextField.Root
              size="2"
              value={values.description}
              placeholder="What this loop does"
              disabled={isSubmitting}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </Flex>

          <Flex direction="column" gap="1" className="max-w-[320px]">
            <Text className="text-[12px] text-gray-10">Visibility</Text>
            <SettingsOptionSelect
              value={values.visibility}
              options={VISIBILITY_OPTIONS}
              disabled={isSubmitting}
              ariaLabel="Visibility"
              onValueChange={(value) =>
                setValues((prev) => ({
                  ...prev,
                  visibility: value as LoopSchemas.LoopVisibilityEnum,
                }))
              }
            />
          </Flex>
        </FormSection>

        <FormSection
          title="Instructions"
          description="The prompt delivered to the agent on every run."
        >
          <TextArea
            value={values.instructions}
            placeholder="Summarize failing CI runs from the last 24 hours and post the summary to #eng-standup."
            disabled={isSubmitting}
            className="min-h-[160px] text-[12.5px] [font-family:var(--font-mono)]"
            onChange={(e) =>
              setValues((prev) => ({ ...prev, instructions: e.target.value }))
            }
          />
        </FormSection>

        <FormSection title="Model">
          <LoopModelFields
            adapter={values.runtimeAdapter}
            model={values.model}
            reasoningEffort={values.reasoningEffort}
            disabled={isSubmitting}
            onAdapterChange={(runtimeAdapter) =>
              setValues((prev) => ({ ...prev, runtimeAdapter }))
            }
            onModelChange={(model) => setValues((prev) => ({ ...prev, model }))}
            onReasoningEffortChange={(reasoningEffort) =>
              setValues((prev) => ({ ...prev, reasoningEffort }))
            }
          />
        </FormSection>

        <FormSection
          title="Repository"
          description="Optional — leave empty for a report-only loop that works purely through connectors."
        >
          <LoopRepositoryPicker
            value={values.repository}
            disabled={isSubmitting}
            onChange={(repository) =>
              setValues((prev) => ({ ...prev, repository }))
            }
          />
        </FormSection>

        <FormSection
          title="Triggers"
          description="When this loop runs. Add as many as you need."
        >
          <LoopTriggerEditor
            triggers={values.triggers}
            triggerEndpointPath={triggerEndpointPath}
            disabled={isSubmitting}
            onChange={(triggers) =>
              setValues((prev) => ({ ...prev, triggers }))
            }
          />
        </FormSection>

        <FormSection title="Notifications">
          <LoopNotificationsFields
            notifications={values.notifications}
            disabled={isSubmitting}
            onChange={(notifications) =>
              setValues((prev) => ({ ...prev, notifications }))
            }
          />
        </FormSection>

        <Flex justify="end" gap="2">
          <Button
            variant="soft"
            color="gray"
            size="1"
            disabled={isSubmitting}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            size="1"
            loading={isSubmitting}
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {isEdit ? "Save changes" : "Create loop"}
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="0">
        <Text className="font-medium text-[13px] text-gray-12">{title}</Text>
        {description ? (
          <Text className="text-[12px] text-gray-10">{description}</Text>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}
