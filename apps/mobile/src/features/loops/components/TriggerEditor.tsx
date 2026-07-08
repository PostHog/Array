import { Text } from "@components/text";
import { Plus, Trash } from "phosphor-react-native";
import { Pressable, Switch, TextInput, View } from "react-native";
import { useAuthStore } from "@/features/auth";
import { ScheduleEditor } from "@/features/tasks/components/ScheduleEditor";
import { useIntegrations } from "@/features/tasks/hooks/useIntegrations";
import { toRepositorySelection } from "@/features/tasks/utils/repositorySelection";
import { useThemeColors } from "@/lib/theme";
import type { LoopTriggerType } from "../types";
import {
  createDefaultTriggerDraft,
  describeTriggerDraft,
  GITHUB_TRIGGER_EVENT_OPTIONS,
  type LoopTriggerDraft,
  TRIGGER_TYPE_LABELS,
} from "../utils/loopTriggers";
import { RepositoryField } from "./RepositoryField";

interface TriggerEditorProps {
  triggers: LoopTriggerDraft[];
  onChange: (triggers: LoopTriggerDraft[]) => void;
  defaultTimezone: string;
  loopId?: string;
}

const ADD_TRIGGER_OPTIONS: LoopTriggerType[] = ["schedule", "github", "api"];

function TriggerCard({
  draft,
  onUpdate,
  onRemove,
  repositoryOptions,
  isLoadingRepositories,
  loopId,
}: {
  draft: LoopTriggerDraft;
  onUpdate: (updates: Partial<LoopTriggerDraft>) => void;
  onRemove: () => void;
  repositoryOptions: ReturnType<typeof useIntegrations>["repositoryOptions"];
  isLoadingRepositories: boolean;
  loopId?: string;
}) {
  const themeColors = useThemeColors();
  const { cloudRegion, projectId, getCloudUrlFromRegion } = useAuthStore();

  return (
    <View className="gap-3 rounded-xl bg-gray-2 p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-[15px] text-gray-12">
            {TRIGGER_TYPE_LABELS[draft.type]}
          </Text>
          <Text className="mt-0.5 text-gray-9 text-xs">
            {describeTriggerDraft(draft)}
          </Text>
        </View>
        <Switch
          value={draft.enabled}
          onValueChange={(enabled) => onUpdate({ enabled })}
        />
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          className="ml-3 h-8 w-8 items-center justify-center rounded-lg active:bg-gray-3"
          accessibilityLabel="Remove trigger"
        >
          <Trash size={16} color={themeColors.status.error} />
        </Pressable>
      </View>

      {draft.type === "schedule" && (
        <View className="gap-3">
          <View className="flex-row gap-2">
            {(["recurring", "once"] as const).map((mode) => {
              const isSelected = draft.scheduleMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => onUpdate({ scheduleMode: mode })}
                  className={`rounded-xl border px-3 py-2 ${
                    isSelected
                      ? "border-accent-8 bg-accent-3"
                      : "border-gray-5 bg-background"
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      isSelected ? "text-accent-11" : "text-gray-11"
                    }`}
                  >
                    {mode === "recurring" ? "Recurring" : "One-time"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {draft.scheduleMode === "recurring" ? (
            <ScheduleEditor
              value={draft.scheduleDraft}
              timezone={draft.timezone}
              onChange={(scheduleDraft) => onUpdate({ scheduleDraft })}
              onTimezoneChange={(timezone) => onUpdate({ timezone })}
            />
          ) : (
            <View>
              <Text className="mb-1 text-gray-9 text-xs">
                Run once at (ISO 8601, e.g. 2026-08-01T09:00:00Z)
              </Text>
              <TextInput
                className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
                placeholder="2026-08-01T09:00:00Z"
                placeholderTextColor={themeColors.gray[9]}
                value={draft.runAt}
                onChangeText={(runAt) => onUpdate({ runAt })}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text className="mt-2 mb-1 text-gray-9 text-xs">Timezone</Text>
              <TextInput
                className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
                placeholder="Europe/London"
                placeholderTextColor={themeColors.gray[9]}
                value={draft.timezone}
                onChangeText={(timezone) => onUpdate({ timezone })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}
        </View>
      )}

      {draft.type === "github" && (
        <View className="gap-3">
          <RepositoryField
            repositoryOptions={repositoryOptions}
            selection={{
              integrationId: draft.githubIntegrationId,
              repository: draft.githubRepository,
            }}
            loading={isLoadingRepositories}
            onChange={(option) => {
              const selection = toRepositorySelection(option);
              onUpdate({
                githubIntegrationId: selection.integrationId,
                githubRepository: selection.repository,
              });
            }}
          />

          <View>
            <Text className="mb-2 text-gray-9 text-xs">Events</Text>
            <View className="flex-row flex-wrap gap-2">
              {GITHUB_TRIGGER_EVENT_OPTIONS.map((option) => {
                const isSelected = draft.githubEvents.includes(option.value);
                return (
                  <Pressable
                    key={option.value}
                    onPress={() =>
                      onUpdate({
                        githubEvents: isSelected
                          ? draft.githubEvents.filter(
                              (event) => event !== option.value,
                            )
                          : [...draft.githubEvents, option.value],
                      })
                    }
                    className={`rounded-xl border px-3 py-2 ${
                      isSelected
                        ? "border-accent-8 bg-accent-3"
                        : "border-gray-5 bg-background"
                    }`}
                  >
                    <Text
                      className={`text-sm ${
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

          <View className="gap-2">
            <Text className="text-gray-9 text-xs">
              Filters (optional, comma-separated)
            </Text>
            <TextInput
              className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
              placeholder="Branches, e.g. main, release/*"
              placeholderTextColor={themeColors.gray[9]}
              value={draft.githubFilterBranches}
              onChangeText={(githubFilterBranches) =>
                onUpdate({ githubFilterBranches })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
              placeholder="Labels, e.g. bug, needs-triage"
              placeholderTextColor={themeColors.gray[9]}
              value={draft.githubFilterLabels}
              onChangeText={(githubFilterLabels) =>
                onUpdate({ githubFilterLabels })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
              placeholder="Actions, e.g. opened, labeled"
              placeholderTextColor={themeColors.gray[9]}
              value={draft.githubFilterActions}
              onChangeText={(githubFilterActions) =>
                onUpdate({ githubFilterActions })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
      )}

      {draft.type === "api" && (
        <View className="rounded-lg bg-background px-3.5 py-3">
          <Text className="mb-1 text-[13px] text-gray-12">
            POST{" "}
            {cloudRegion && projectId
              ? `${getCloudUrlFromRegion(cloudRegion)}/api/projects/${projectId}/loops/${loopId ?? "{loop_id}"}/trigger/`
              : "…/api/projects/:project_id/loops/:loop_id/trigger/"}
          </Text>
          <Text className="text-gray-9 text-xs">
            Authenticate with a project secret API key (scope loop:write). The
            request body becomes the run context. Send an Idempotency-Key header
            to make retries safe.
          </Text>
        </View>
      )}
    </View>
  );
}

export function TriggerEditor({
  triggers,
  onChange,
  defaultTimezone,
  loopId,
}: TriggerEditorProps) {
  const themeColors = useThemeColors();
  const { repositoryOptions, isLoading } = useIntegrations();

  const updateTrigger = (
    draftId: string,
    updates: Partial<LoopTriggerDraft>,
  ) => {
    onChange(
      triggers.map((trigger) =>
        trigger.draftId === draftId ? { ...trigger, ...updates } : trigger,
      ),
    );
  };

  const removeTrigger = (draftId: string) => {
    onChange(triggers.filter((trigger) => trigger.draftId !== draftId));
  };

  const addTrigger = (type: LoopTriggerType) => {
    onChange([...triggers, createDefaultTriggerDraft(type, defaultTimezone)]);
  };

  return (
    <View className="gap-3">
      {triggers.map((draft) => (
        <TriggerCard
          key={draft.draftId}
          draft={draft}
          onUpdate={(updates) => updateTrigger(draft.draftId, updates)}
          onRemove={() => removeTrigger(draft.draftId)}
          repositoryOptions={repositoryOptions}
          isLoadingRepositories={isLoading}
          loopId={loopId}
        />
      ))}

      <View className="flex-row flex-wrap gap-2">
        {ADD_TRIGGER_OPTIONS.map((type) => (
          <Pressable
            key={type}
            onPress={() => addTrigger(type)}
            className="flex-row items-center gap-1.5 rounded-xl border border-gray-5 bg-background px-3 py-2 active:bg-gray-3"
          >
            <Plus size={14} color={themeColors.gray[11]} weight="bold" />
            <Text className="text-gray-11 text-sm">
              {TRIGGER_TYPE_LABELS[type]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
