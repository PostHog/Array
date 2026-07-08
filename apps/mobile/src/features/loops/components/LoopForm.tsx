import { Text } from "@components/text";
import { getCalendars } from "expo-localization";
import { type MutableRefObject, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Switch,
  TextInput,
  View,
} from "react-native";
import { MarkdownText } from "@/features/chat/components/MarkdownText";
import { DEFAULT_MODEL } from "@/features/tasks/composer/options";
import { useIntegrations } from "@/features/tasks/hooks/useIntegrations";
import type { RepositorySelection } from "@/features/tasks/types";
import {
  isRepositorySelectionComplete,
  toRepositorySelection,
} from "@/features/tasks/utils/repositorySelection";
import { useThemeColors } from "@/lib/theme";
import type {
  Loop,
  LoopBehaviors,
  LoopConnectors,
  LoopNotifications,
  LoopOverlapPolicy,
  LoopReasoningEffort,
  LoopRepositoryEntry,
  LoopRuntimeAdapter,
  LoopVisibility,
  LoopWrite,
} from "../types";
import {
  createDefaultBehaviors,
  createDefaultConnectors,
  createDefaultNotifications,
} from "../utils/loopDefaults";
import {
  draftToTriggerWrite,
  isTriggerDraftValid,
  type LoopTriggerDraft,
  triggerToDraft,
} from "../utils/loopTriggers";
import { ModelPicker } from "./ModelPicker";
import { NotificationToggles } from "./NotificationToggles";
import { RepositoryField } from "./RepositoryField";
import { TriggerEditor } from "./TriggerEditor";

interface LoopFormProps {
  /** Present when editing an existing loop; omitted when creating one. */
  loop?: Loop;
  isSubmitting: boolean;
  submitLabel: string;
  generalError?: string | null;
  onSubmit: (values: LoopWrite) => Promise<void> | void;
  onCancel?: () => void;
  /** See `AutomationForm` — suppresses the built-in footer so a parent
   *  screen can render its own floating action button. */
  hideFooter?: boolean;
  submitRef?: MutableRefObject<(() => void) | null>;
  onCanSubmitChange?: (canSubmit: boolean) => void;
}

const VISIBILITY_OPTIONS: Array<{ value: LoopVisibility; label: string }> = [
  { value: "personal", label: "Personal" },
  { value: "team", label: "Team" },
];

const OVERLAP_POLICY_OPTIONS: Array<{
  value: LoopOverlapPolicy;
  label: string;
  description: string;
}> = [
  {
    value: "skip",
    label: "Skip",
    description: "Drop the fire if a run is active",
  },
  {
    value: "allow",
    label: "Allow",
    description: "Run alongside the active run",
  },
  {
    value: "cancel_previous",
    label: "Cancel previous",
    description: "Cancel the active run, then start",
  },
];

export function LoopForm({
  loop,
  isSubmitting,
  submitLabel,
  generalError,
  onSubmit,
  onCancel,
  hideFooter = false,
  submitRef,
  onCanSubmitChange,
}: LoopFormProps) {
  const themeColors = useThemeColors();
  const {
    repositoryOptions,
    isLoading: isLoadingRepositories,
    isRefreshingInBackground,
  } = useIntegrations();

  const defaultTimezone = useMemo(
    () => getCalendars()[0]?.timeZone ?? "UTC",
    [],
  );

  const [name, setName] = useState(loop?.name ?? "");
  const [description, setDescription] = useState(loop?.description ?? "");
  const [visibility, setVisibility] = useState<LoopVisibility>(
    loop?.visibility ?? "personal",
  );
  const [instructions, setInstructions] = useState(loop?.instructions ?? "");
  const [instructionsMode, setInstructionsMode] = useState<"edit" | "preview">(
    "edit",
  );
  const [runtimeAdapter, setRuntimeAdapter] = useState<LoopRuntimeAdapter>(
    loop?.runtime_adapter ?? "claude",
  );
  const [model, setModel] = useState(loop?.model ?? DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffort] =
    useState<LoopReasoningEffort | null>(loop?.reasoning_effort ?? null);
  const [repositorySelection, setRepositorySelection] =
    useState<RepositorySelection>(() => {
      const [first] = loop?.repositories ?? [];
      return {
        integrationId: first?.github_integration_id ?? null,
        repository: first?.full_name ?? null,
      };
    });
  const [enabled, setEnabled] = useState(loop?.enabled ?? true);
  const [overlapPolicy, setOverlapPolicy] = useState<LoopOverlapPolicy>(
    loop?.overlap_policy ?? "skip",
  );
  const [behaviors, setBehaviors] = useState<LoopBehaviors>(
    loop?.behaviors ?? createDefaultBehaviors(),
  );
  const [connectors, setConnectors] = useState<LoopConnectors>(
    loop?.connectors ?? createDefaultConnectors(),
  );
  const [notifications, setNotifications] = useState<LoopNotifications>(
    loop?.notifications ?? createDefaultNotifications(),
  );
  const [triggerDrafts, setTriggerDrafts] = useState<LoopTriggerDraft[]>(
    () =>
      loop?.triggers.map((trigger) =>
        triggerToDraft(trigger, defaultTimezone),
      ) ?? [],
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const triggersValid = triggerDrafts.every(isTriggerDraftValid);
  const canSubmit =
    !!name.trim() && !!instructions.trim() && triggersValid && !isSubmitting;

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit) {
      return;
    }

    const repositories: LoopRepositoryEntry[] = isRepositorySelectionComplete(
      repositorySelection,
    )
      ? [
          {
            github_integration_id: repositorySelection.integrationId as number,
            full_name: repositorySelection.repository as string,
          },
        ]
      : [];

    await onSubmit({
      name: name.trim(),
      description: description.trim(),
      visibility,
      instructions: instructions.trim(),
      runtime_adapter: runtimeAdapter,
      model: model.trim(),
      reasoning_effort: reasoningEffort,
      repositories,
      enabled,
      overlap_policy: overlapPolicy,
      behaviors,
      connectors,
      notifications,
      triggers: triggerDrafts.map(draftToTriggerWrite),
    });
  };

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = handleSubmit;
    return () => {
      if (submitRef.current === handleSubmit) submitRef.current = null;
    };
  });

  useEffect(() => {
    onCanSubmitChange?.(canSubmit);
  }, [onCanSubmitChange, canSubmit]);

  return (
    <View className="gap-4">
      <View className="rounded-xl bg-gray-2 p-4">
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Name
        </Text>
        <TextInput
          className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
          placeholder="Daily CI triage"
          placeholderTextColor={themeColors.gray[9]}
          value={name}
          onChangeText={setName}
        />
        {hasAttemptedSubmit && !name.trim() && (
          <Text className="mt-1 text-status-error text-xs">
            Name is required.
          </Text>
        )}

        <Text
          className="mt-4 mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Description
        </Text>
        <TextInput
          className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
          placeholder="What this loop is for (optional)"
          placeholderTextColor={themeColors.gray[9]}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      <View className="rounded-xl bg-gray-2 p-4">
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Visibility
        </Text>
        <View className="flex-row gap-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const isSelected = visibility === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setVisibility(option.value)}
                className={`flex-1 rounded-xl border px-3 py-2.5 ${
                  isSelected
                    ? "border-accent-8 bg-accent-3"
                    : "border-gray-5 bg-background"
                }`}
              >
                <Text
                  className={`text-center text-sm ${
                    isSelected ? "text-accent-11" : "text-gray-11"
                  }`}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="rounded-xl bg-gray-2 p-4">
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Repository (optional)
        </Text>
        <RepositoryField
          repositoryOptions={repositoryOptions}
          selection={repositorySelection}
          loading={isLoadingRepositories}
          isRefreshing={isRefreshingInBackground}
          onChange={(option) =>
            setRepositorySelection(toRepositorySelection(option))
          }
          placeholder="No repository — connectors only"
        />
      </View>

      <View className="rounded-xl bg-gray-2 p-4">
        <ModelPicker
          runtimeAdapter={runtimeAdapter}
          model={model}
          reasoningEffort={reasoningEffort}
          onRuntimeAdapterChange={setRuntimeAdapter}
          onModelChange={setModel}
          onReasoningEffortChange={setReasoningEffort}
        />
      </View>

      <View className="rounded-xl bg-gray-2 p-4">
        <Text
          className="mb-3 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Triggers
        </Text>
        <TriggerEditor
          triggers={triggerDrafts}
          onChange={setTriggerDrafts}
          defaultTimezone={defaultTimezone}
          loopId={loop?.id}
        />
        {hasAttemptedSubmit && !triggersValid && (
          <Text className="mt-2 text-status-error text-xs">
            Fill in every trigger's required fields before saving.
          </Text>
        )}
      </View>

      <View className="gap-3 rounded-xl bg-gray-2 p-4">
        <Text
          className="text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Behaviors
        </Text>
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 pr-3 text-[14px] text-gray-12">
            Open pull requests
          </Text>
          <Switch
            value={behaviors.create_prs}
            onValueChange={(create_prs) =>
              setBehaviors({ ...behaviors, create_prs })
            }
          />
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 pr-3 text-[14px] text-gray-12">
            Watch CI on loop-created PRs
          </Text>
          <Switch
            value={behaviors.watch_ci}
            onValueChange={(watch_ci) =>
              setBehaviors({ ...behaviors, watch_ci })
            }
          />
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 pr-3 text-[14px] text-gray-12">
            Fix review comments
          </Text>
          <Switch
            value={behaviors.fix_review_comments}
            onValueChange={(fix_review_comments) =>
              setBehaviors({ ...behaviors, fix_review_comments })
            }
          />
        </View>
        {(behaviors.watch_ci || behaviors.fix_review_comments) && (
          <View>
            <Text className="mb-1 text-gray-9 text-xs">Max fix iterations</Text>
            <TextInput
              className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
              value={String(behaviors.max_fix_iterations)}
              onChangeText={(value) => {
                const parsed = Number(value.replace(/\D/g, ""));
                setBehaviors({
                  ...behaviors,
                  max_fix_iterations: Number.isFinite(parsed)
                    ? Math.min(10, Math.max(0, parsed))
                    : 0,
                });
              }}
              keyboardType="number-pad"
            />
          </View>
        )}
      </View>

      <View className="gap-3 rounded-xl bg-gray-2 p-4">
        <Text
          className="text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          PostHog MCP access
        </Text>
        <View className="flex-row gap-2">
          {(["read_only", "full"] as const).map((scope) => {
            const isSelected = connectors.posthog_mcp_scopes === scope;
            return (
              <Pressable
                key={scope}
                onPress={() =>
                  setConnectors({ ...connectors, posthog_mcp_scopes: scope })
                }
                className={`flex-1 rounded-xl border px-3 py-2.5 ${
                  isSelected
                    ? "border-accent-8 bg-accent-3"
                    : "border-gray-5 bg-background"
                }`}
              >
                <Text
                  className={`text-center text-sm ${
                    isSelected ? "text-accent-11" : "text-gray-11"
                  }`}
                >
                  {scope === "read_only" ? "Read-only" : "Full"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="rounded-xl bg-gray-2 p-4">
        <Text
          className="mb-3 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Notifications
        </Text>
        <NotificationToggles
          notifications={notifications}
          onChange={setNotifications}
        />
      </View>

      <View className="gap-3 rounded-xl bg-gray-2 p-4">
        <Text
          className="text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          If a run is already active
        </Text>
        <View className="gap-2">
          {OVERLAP_POLICY_OPTIONS.map((option) => {
            const isSelected = overlapPolicy === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setOverlapPolicy(option.value)}
                className={`rounded-xl border px-3.5 py-3 ${
                  isSelected
                    ? "border-accent-8 bg-accent-3"
                    : "border-gray-5 bg-background"
                }`}
              >
                <Text
                  className={`text-sm ${
                    isSelected ? "text-accent-11" : "text-gray-12"
                  }`}
                >
                  {option.label}
                </Text>
                <Text className="mt-0.5 text-gray-9 text-xs">
                  {option.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="flex-row items-center justify-between rounded-xl bg-gray-2 px-4 py-4">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-[15px] text-gray-12">
            Enabled
          </Text>
          <Text className="mt-1 text-gray-9 text-xs">
            Turn this off to pause every trigger without deleting the loop.
          </Text>
        </View>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>

      <View className="rounded-xl bg-gray-2 p-4">
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Instructions
        </Text>
        <View className="mb-2 flex-row gap-2">
          {(["edit", "preview"] as const).map((mode) => {
            const active = instructionsMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => setInstructionsMode(mode)}
                className={`rounded-lg border px-3 py-2 ${
                  active
                    ? "border-accent-9 bg-accent-3"
                    : "border-gray-5 bg-background"
                }`}
              >
                <Text
                  className={`font-medium text-[13px] ${
                    active ? "text-accent-11" : "text-gray-11"
                  }`}
                >
                  {mode === "edit" ? "Edit" : "Preview"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {instructionsMode === "edit" ? (
          <TextInput
            className="min-h-[128px] rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
            placeholder="What should this loop ask the agent to do on every run?"
            placeholderTextColor={themeColors.gray[9]}
            value={instructions}
            onChangeText={setInstructions}
            multiline
            textAlignVertical="top"
          />
        ) : (
          <View className="min-h-[128px] rounded-xl border border-gray-5 bg-background px-3.5 py-3">
            {instructions.trim() ? (
              <MarkdownText content={instructions} />
            ) : (
              <Text className="text-gray-9 text-sm">
                Nothing to preview yet.
              </Text>
            )}
          </View>
        )}
        {hasAttemptedSubmit && !instructions.trim() && (
          <Text className="mt-1 text-status-error text-xs">
            Instructions are required.
          </Text>
        )}
      </View>

      {generalError && (
        <View className="rounded-xl bg-status-error/10 px-4 py-3">
          <Text className="text-sm text-status-error">{generalError}</Text>
        </View>
      )}

      {!hideFooter && (
        <View className="flex-row gap-3">
          {onCancel && (
            <Pressable
              onPress={onCancel}
              className="flex-1 rounded-xl border border-gray-6 bg-gray-2 py-3"
            >
              <Text className="text-center font-medium text-gray-12">
                Cancel
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            className={`rounded-xl py-3 ${
              onCancel ? "flex-1" : ""
            } ${canSubmit ? "bg-accent-9" : "bg-gray-3"}`}
          >
            {isSubmitting ? (
              <ActivityIndicator
                size="small"
                color={themeColors.accent.contrast}
              />
            ) : (
              <Text
                className={`text-center font-medium ${
                  canSubmit ? "text-accent-contrast" : "text-gray-9"
                }`}
              >
                {submitLabel}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}
