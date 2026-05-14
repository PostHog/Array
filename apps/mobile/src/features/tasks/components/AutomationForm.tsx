import { Text } from "@components/text";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useIntegrations } from "../hooks/useIntegrations";
import type {
  CreateTaskAutomationOptions,
  RepositorySelection,
} from "../types";
import {
  type AutomationScheduleDraft,
  buildCronExpression,
  createDefaultScheduleDraft,
  deriveAutomationName,
  parseCronExpression,
} from "../utils/automationSchedule";
import { isRepositorySelectionComplete } from "../utils/repositorySelection";
import { GitHubConnectionPrompt } from "./GitHubConnectionPrompt";
import { GitHubLoadNotice } from "./GitHubLoadNotice";
import { RepositorySelector } from "./RepositorySelector";
import { ScheduleEditor } from "./ScheduleEditor";

interface AutomationFormProps {
  initialValues?: {
    name?: string;
    prompt?: string;
    repositorySelection?: RepositorySelection;
    cronExpression?: string;
    timezone?: string;
    enabled?: boolean;
  };
  isSubmitting: boolean;
  submitLabel: string;
  fieldError?: {
    attr: string | null;
    message: string | null;
  } | null;
  generalError?: string | null;
  onSubmit: (values: CreateTaskAutomationOptions) => Promise<void> | void;
  onCancel?: () => void;
  repositoryRequired?: boolean;
}

export function AutomationForm({
  initialValues,
  isSubmitting,
  submitLabel,
  fieldError,
  generalError,
  onSubmit,
  onCancel,
  repositoryRequired = true,
}: AutomationFormProps) {
  const themeColors = useThemeColors();
  const {
    error,
    hasGithubIntegration,
    repositoryOptions,
    repositoryWarning,
    isLoading,
    refetch,
  } = useIntegrations({ enabled: repositoryRequired });

  const [name, setName] = useState(initialValues?.name ?? "");
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? "");
  const [timezone, setTimezone] = useState(initialValues?.timezone ?? "UTC");
  const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
  const [repositorySelection, setRepositorySelection] =
    useState<RepositorySelection>(
      initialValues?.repositorySelection ?? {
        integrationId: null,
        repository: null,
      },
    );
  const [scheduleDraft, setScheduleDraft] = useState<AutomationScheduleDraft>(
    initialValues?.cronExpression
      ? parseCronExpression(initialValues.cronExpression)
      : createDefaultScheduleDraft(),
  );
  const [hasEditedName, setHasEditedName] = useState(
    !!initialValues?.name?.trim(),
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (hasEditedName) {
      return;
    }

    setName(deriveAutomationName(prompt));
  }, [prompt, hasEditedName]);

  const validationErrors = useMemo(
    () => ({
      name:
        fieldError?.attr === "name"
          ? fieldError.message
          : hasAttemptedSubmit && !name.trim()
            ? "Name is required."
            : null,
      prompt:
        fieldError?.attr === "prompt"
          ? fieldError.message
          : hasAttemptedSubmit && !prompt.trim()
            ? "Prompt is required."
            : null,
      repository:
        fieldError?.attr === "repository"
          ? fieldError.message
          : repositoryRequired &&
              hasAttemptedSubmit &&
              !isRepositorySelectionComplete(repositorySelection)
            ? "Repository selection is required."
            : null,
      cronExpression:
        fieldError?.attr === "cron_expression" ? fieldError.message : null,
      timezone:
        fieldError?.attr === "timezone"
          ? fieldError.message
          : hasAttemptedSubmit && !timezone.trim()
            ? "Timezone is required."
            : null,
    }),
    [
      fieldError,
      hasAttemptedSubmit,
      name,
      prompt,
      repositorySelection,
      repositoryRequired,
      timezone,
    ],
  );

  const canSubmit =
    !!name.trim() &&
    !!prompt.trim() &&
    !!timezone.trim() &&
    (!repositoryRequired ||
      isRepositorySelectionComplete(repositorySelection)) &&
    !isSubmitting;
  const repositoryLoadBlocked =
    repositoryRequired && !!repositoryWarning && repositoryOptions.length === 0;

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit) {
      return;
    }

    await onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      repository: repositoryRequired
        ? (repositorySelection.repository ?? "")
        : "",
      github_integration: repositoryRequired
        ? repositorySelection.integrationId
        : null,
      cron_expression: buildCronExpression(scheduleDraft),
      timezone: timezone.trim(),
      enabled,
    });
  };

  if (repositoryRequired && isLoading && hasGithubIntegration === null) {
    return (
      <View className="items-center rounded-xl border border-gray-6 bg-gray-2 p-5">
        <ActivityIndicator size="small" color={themeColors.accent[9]} />
        <Text className="mt-2 text-gray-11 text-sm">
          Loading repositories...
        </Text>
      </View>
    );
  }

  if (repositoryRequired && (error || repositoryLoadBlocked)) {
    return (
      <GitHubLoadNotice
        message={
          error ?? repositoryWarning ?? "Could not load GitHub repositories."
        }
        onRetry={refetch}
      />
    );
  }

  if (repositoryRequired && hasGithubIntegration === false) {
    return (
      <GitHubConnectionPrompt
        onConnected={refetch}
        title="Connect GitHub to create automations"
        description="Automations need repository access before they can run."
      />
    );
  }

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
          placeholder="Daily PR review"
          placeholderTextColor={themeColors.gray[9]}
          value={name}
          onChangeText={(nextName) => {
            setHasEditedName(true);
            setName(nextName);
          }}
        />
        {validationErrors.name && (
          <Text className="mt-1 text-status-error text-xs">
            {validationErrors.name}
          </Text>
        )}

        <Text
          className="mt-4 mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Prompt
        </Text>
        <TextInput
          className="min-h-[128px] rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
          placeholder="What should this automation ask the agent to do?"
          placeholderTextColor={themeColors.gray[9]}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          textAlignVertical="top"
        />
        {validationErrors.prompt && (
          <Text className="mt-1 text-status-error text-xs">
            {validationErrors.prompt}
          </Text>
        )}
      </View>

      {repositoryRequired && (
        <View className="rounded-xl bg-gray-2 p-4">
          {repositoryWarning && (
            <GitHubLoadNotice
              message={repositoryWarning}
              onRetry={refetch}
              tone="warning"
            />
          )}
          <Text
            className="mb-2 text-[11px] text-gray-9 uppercase"
            style={{ letterSpacing: 0.5 }}
          >
            Repository
          </Text>
          <RepositorySelector
            options={repositoryOptions}
            value={repositorySelection}
            onChange={setRepositorySelection}
          />
          {validationErrors.repository && (
            <Text className="mt-1 text-status-error text-xs">
              {validationErrors.repository}
            </Text>
          )}
        </View>
      )}

      <View className="rounded-xl bg-gray-2 p-4">
        <ScheduleEditor
          value={scheduleDraft}
          timezone={timezone}
          onChange={setScheduleDraft}
          onTimezoneChange={setTimezone}
        />
        {(validationErrors.cronExpression || validationErrors.timezone) && (
          <Text className="mt-1 text-status-error text-xs">
            {validationErrors.cronExpression || validationErrors.timezone}
          </Text>
        )}
      </View>

      <View className="flex-row items-center justify-between rounded-xl bg-gray-2 px-4 py-4">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-[15px] text-gray-12">
            Enabled
          </Text>
          <Text className="mt-1 text-gray-9 text-xs">
            Turn this off to pause scheduled runs without deleting it.
          </Text>
        </View>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>

      {generalError && (
        <View className="rounded-xl bg-status-error/10 px-4 py-3">
          <Text className="text-sm text-status-error">{generalError}</Text>
        </View>
      )}

      <View className="flex-row gap-3">
        {onCancel && (
          <Pressable
            onPress={onCancel}
            className="flex-1 rounded-xl border border-gray-6 bg-gray-2 py-3"
          >
            <Text className="text-center font-medium text-gray-12">Cancel</Text>
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
    </View>
  );
}
