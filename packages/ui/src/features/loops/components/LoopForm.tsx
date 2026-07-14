import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  Check,
} from "@phosphor-icons/react";
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
import { type ReactNode, useEffect, useState } from "react";
import { useAuthStateValue } from "../../auth/store";
import { useCreateLoop, useUpdateLoop } from "../hooks/useLoopMutations";
import { useLoopDraftStore } from "../loopDraftStore";
import {
  emptyLoopFormValues,
  formValuesToLoopWrite,
  isLoopFormValid,
  isTriggerDraftValid,
  type LoopFormValues,
  loopToFormValues,
} from "../loopFormTypes";
import { Field } from "./LoopFormPrimitives";
import { LoopModelFields } from "./LoopModelFields";
import { LoopNotificationsFields } from "./LoopNotificationsFields";
import { LoopRepositoryPicker } from "./LoopRepositoryPicker";
import { LoopTriggerEditor } from "./LoopTriggerEditor";

const VISIBILITY_OPTIONS: {
  value: LoopSchemas.LoopVisibilityEnum;
  label: string;
}[] = [
  { value: "personal", label: "Personal (only you)" },
  { value: "team", label: "Team (everyone on the project)" },
];

const ADAPTER_LABELS: Record<LoopSchemas.LoopRuntimeAdapterEnum, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const STEPS = ["Prompt", "When", "Options", "Review"] as const;

interface LoopFormProps {
  /** Present in edit mode; absent when creating a new loop. */
  loop?: LoopSchemas.Loop;
}

export function LoopForm({ loop }: LoopFormProps) {
  const isEdit = !!loop;
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const [values, setValues] = useState<LoopFormValues>(() => {
    if (loop) return loopToFormValues(loop);
    // One-shot prefill from the landing prompt or a template; merged over the
    // blank defaults. Read (not consumed) here, then cleared in the effect
    // below so the manual "New loop" button always opens a blank form.
    const prefill = useLoopDraftStore.getState().prefill;
    return { ...emptyLoopFormValues(), ...(prefill ?? {}) };
  });
  const [step, setStep] = useState(0);
  // Open when editing a loop that already pins a model, so the pinned value
  // is visible without hunting for it.
  const [showAdvanced, setShowAdvanced] = useState(
    () => !!(loop && (loop.model || loop.reasoning_effort)),
  );

  useEffect(() => {
    if (!loop) useLoopDraftStore.getState().setPrefill(null);
  }, [loop]);

  const createLoop = useCreateLoop();
  const updateLoop = useUpdateLoop(loop?.id ?? "");
  const isSubmitting = isEdit ? updateLoop.isPending : createLoop.isPending;
  const canSubmit = isLoopFormValid(values) && !isSubmitting;

  // Per-step gate for the Next button. The final Create button is gated on the
  // whole form being valid, so jumping between steps can't submit a bad loop.
  const stepComplete = [
    !!values.name.trim() && !!values.instructions.trim(),
    values.triggers.every(isTriggerDraftValid),
    true,
    isLoopFormValid(values),
  ];
  const isLastStep = step === STEPS.length - 1;

  useSetHeaderContent(
    <Text className="font-medium text-[13px]">
      {isEdit ? `Edit ${loop.name}` : "New loop"}
    </Text>,
  );

  const triggerEndpointPath =
    isEdit && projectId != null
      ? `/api/projects/${projectId}/loops/${loop.id}/trigger/`
      : null;

  const patch = (next: Partial<LoopFormValues>) =>
    setValues((prev) => ({ ...prev, ...next }));

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
    <Box className="flex h-full items-center justify-center p-6">
      <Flex
        direction="column"
        className="max-h-full w-full max-w-[600px] overflow-hidden rounded-(--radius-3) border border-border bg-(--color-panel-solid) shadow-xl"
      >
        <Box className="border-border border-b px-5 pt-5 pb-4">
          <Stepper current={step} complete={stepComplete} onSelect={setStep} />
        </Box>

        <Box className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {step === 0 ? (
            <Step
              title="What should this loop do?"
              description="Name it and write the prompt the agent runs on every fire."
            >
              <Field label="Name" required>
                <TextField.Root
                  size="2"
                  value={values.name}
                  placeholder="Daily standup summary"
                  disabled={isSubmitting}
                  autoFocus
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <Field label="Instructions" required>
                <TextArea
                  value={values.instructions}
                  placeholder="Summarize failing CI runs from the last 24 hours and post the summary to #eng-standup."
                  disabled={isSubmitting}
                  className="min-h-[220px] text-[13px] leading-relaxed"
                  onChange={(e) => patch({ instructions: e.target.value })}
                />
              </Field>
            </Step>
          ) : null}

          {step === 1 ? (
            <Step
              title="When should it run?"
              description="Add one or more triggers. Leave empty to run it only on demand."
            >
              <LoopTriggerEditor
                triggers={values.triggers}
                triggerEndpointPath={triggerEndpointPath}
                disabled={isSubmitting}
                onChange={(triggers) => patch({ triggers })}
              />
            </Step>
          ) : null}

          {step === 2 ? (
            <Step
              title="Options"
              description="Who can see it and how you hear about runs."
            >
              <Field label="Visibility" className="max-w-[340px]">
                <SettingsOptionSelect
                  value={values.visibility}
                  options={VISIBILITY_OPTIONS}
                  disabled={isSubmitting}
                  ariaLabel="Visibility"
                  onValueChange={(value) =>
                    patch({
                      visibility: value as LoopSchemas.LoopVisibilityEnum,
                    })
                  }
                />
              </Field>

              <Divider />

              <Field
                label="Repository"
                hint={
                  values.repositories.length > 1
                    ? `${values.repositories.length - 1} more ${
                        values.repositories.length === 2
                          ? "repository stays"
                          : "repositories stay"
                      } attached to this loop.`
                    : "Optional. Leave empty for a report-only loop that works purely through connectors."
                }
              >
                <LoopRepositoryPicker
                  value={values.repositories[0] ?? null}
                  disabled={isSubmitting}
                  onChange={(repository) =>
                    setValues((prev) => ({
                      ...prev,
                      repositories: repository
                        ? [repository, ...prev.repositories.slice(1)]
                        : prev.repositories.slice(1),
                    }))
                  }
                />
              </Field>

              <Divider />

              <Field label="Notifications">
                <LoopNotificationsFields
                  notifications={values.notifications}
                  disabled={isSubmitting}
                  onChange={(notifications) => patch({ notifications })}
                />
              </Field>

              <Divider />

              <Flex direction="column" gap="4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((open) => !open)}
                  className="flex items-center gap-1.5 text-left"
                >
                  <CaretRight
                    size={12}
                    className={`text-gray-10 transition-transform ${
                      showAdvanced ? "rotate-90" : ""
                    }`}
                  />
                  <Text className="font-medium text-[12.5px] text-gray-11">
                    Advanced
                  </Text>
                  <Text className="text-[11.5px] text-gray-9">
                    Model and reasoning
                  </Text>
                </button>
                {showAdvanced ? (
                  <LoopModelFields
                    adapter={values.runtimeAdapter}
                    model={values.model}
                    reasoningEffort={values.reasoningEffort}
                    disabled={isSubmitting}
                    onAdapterChange={(runtimeAdapter) =>
                      patch({ runtimeAdapter })
                    }
                    onModelChange={(model) => patch({ model })}
                    onReasoningEffortChange={(reasoningEffort) =>
                      patch({ reasoningEffort })
                    }
                  />
                ) : null}
              </Flex>
            </Step>
          ) : null}

          {step === 3 ? (
            <Step
              title="Review"
              description="Check everything before you create the loop."
            >
              <ReviewList values={values} />
            </Step>
          ) : null}
        </Box>

        <Flex
          align="center"
          justify="between"
          gap="3"
          className="border-border border-t px-5 py-3"
        >
          <Button
            variant="soft"
            color="gray"
            size="2"
            disabled={isSubmitting}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Flex gap="2" className="shrink-0">
            {step > 0 ? (
              <Button
                variant="outline"
                color="gray"
                size="2"
                disabled={isSubmitting}
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={13} />
                Back
              </Button>
            ) : null}
            {isLastStep ? (
              <Button
                variant="solid"
                size="2"
                loading={isSubmitting}
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                {isEdit ? "Save changes" : "Create loop"}
              </Button>
            ) : (
              <Button
                variant="solid"
                size="2"
                disabled={!stepComplete[step] || isSubmitting}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
                <ArrowRight size={13} />
              </Button>
            )}
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}

function Stepper({
  current,
  complete,
  onSelect,
}: {
  current: number;
  complete: boolean[];
  onSelect: (step: number) => void;
}) {
  return (
    <Flex align="center" gap="0">
      {STEPS.map((label, index) => {
        const isCurrent = index === current;
        const isDone = index < current && complete[index];
        // Free navigation back to any earlier step; forward only into the step
        // immediately after a completed one, so you can't skip required fields.
        const reachable = index <= current || complete[index - 1];
        return (
          <Flex
            key={label}
            align="center"
            className="min-w-0 flex-1 last:flex-none"
          >
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(index)}
              className="flex min-w-0 items-center gap-2 disabled:cursor-not-allowed"
            >
              <Flex
                align="center"
                justify="center"
                className={`size-5 shrink-0 rounded-full border font-medium text-[11px] ${
                  isCurrent
                    ? "border-(--accent-9) bg-(--accent-9) text-(--accent-contrast)"
                    : isDone
                      ? "border-(--accent-7) bg-(--accent-3) text-(--accent-11)"
                      : "border-(--gray-7) text-gray-11"
                }`}
              >
                {isDone ? <Check size={12} weight="bold" /> : index + 1}
              </Flex>
              <Text
                className={`truncate text-[12.5px] ${
                  isCurrent ? "font-medium text-gray-12" : "text-gray-11"
                }`}
              >
                {label}
              </Text>
            </button>
            {index < STEPS.length - 1 ? (
              <Box className="mx-2 h-px min-w-4 flex-1 bg-(--gray-5)" />
            ) : null}
          </Flex>
        );
      })}
    </Flex>
  );
}

function Step({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Text className="font-medium text-[15px] text-gray-12">{title}</Text>
        <Text className="text-[12.5px] text-gray-10 leading-snug">
          {description}
        </Text>
      </Flex>
      {children}
    </Flex>
  );
}

function Divider() {
  return <Box className="h-px bg-(--gray-4)" />;
}

function ReviewList({ values }: { values: LoopFormValues }) {
  const reasoning = values.reasoningEffort ?? "auto";
  const channels = (["push", "email", "slack"] as const).filter(
    (channel) => values.notifications[channel]?.enabled,
  );

  return (
    <Flex
      direction="column"
      className="divide-y divide-(--gray-4) rounded-(--radius-3) border border-border"
    >
      <ReviewRow label="Name" value={values.name || "Not set"} />
      <ReviewRow
        label="Visibility"
        value={values.visibility === "team" ? "Team" : "Personal"}
      />
      <ReviewRow
        label="Prompt"
        value={values.instructions.trim() || "No prompt"}
        multiline
      />
      <ReviewRow
        label="Model"
        value={`${ADAPTER_LABELS[values.runtimeAdapter]} · ${
          values.model || "Default model"
        } · ${reasoning} reasoning`}
      />
      <ReviewRow
        label="Repository"
        value={
          values.repositories.length > 0
            ? values.repositories.map((repo) => repo.full_name).join(", ")
            : "None (report-only)"
        }
      />
      <ReviewRow
        label="Triggers"
        value={
          values.triggers.length === 0
            ? "Manual only"
            : values.triggers.map(describeTrigger).join(", ")
        }
      />
      <ReviewRow
        label="Notifications"
        value={channels.length === 0 ? "None" : channels.join(", ")}
      />
    </Flex>
  );
}

function ReviewRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <Flex gap="4" className="px-3 py-2.5">
      <Text className="w-24 shrink-0 text-[12px] text-gray-10">{label}</Text>
      <Text
        className={`min-w-0 flex-1 text-[12.5px] text-gray-12 ${
          multiline ? "whitespace-pre-wrap" : "truncate"
        }`}
      >
        {value}
      </Text>
    </Flex>
  );
}

function describeTrigger(trigger: LoopFormValues["triggers"][number]): string {
  if (trigger.type === "schedule") {
    const config = trigger.config as LoopSchemas.LoopScheduleTriggerConfig;
    if (config.run_at) return "Once";
    return `Schedule (${config.cron_expression ?? "cron"})`;
  }
  if (trigger.type === "github") {
    const config = trigger.config as LoopSchemas.LoopGithubTriggerConfig;
    const repo = config.repository || "a repo";
    return `GitHub (${repo})`;
  }
  return "API";
}
