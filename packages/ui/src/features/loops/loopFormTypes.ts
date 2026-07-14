import type { LoopSchemas } from "@posthog/api-client/loops";

/**
 * A trigger row in the create/edit form. `key` is a client-only stable
 * identity for list rendering (new rows have no server `id` yet); `id` is
 * only present once the trigger has been persisted, and is carried through
 * to the write payload so the backend updates the row in place instead of
 * creating a duplicate (see the Lifecycle section of the Loops spec on
 * id-stable trigger writes).
 */
export interface LoopTriggerDraft {
  key: string;
  id?: string;
  type: LoopSchemas.LoopTriggerTypeEnum;
  enabled: boolean;
  config: LoopSchemas.LoopTriggerConfig;
}

export interface LoopFormValues {
  name: string;
  description: string;
  visibility: LoopSchemas.LoopVisibilityEnum;
  instructions: string;
  runtimeAdapter: LoopSchemas.LoopRuntimeAdapterEnum;
  model: string;
  reasoningEffort: LoopSchemas.LoopReasoningEffortEnum | null;
  /**
   * Full desired repository list. The form's picker only edits the first
   * entry; any additional entries are carried through untouched so saving an
   * unrelated change never drops a loop's other repository associations.
   */
  repositories: LoopSchemas.LoopRepositoryEntry[];
  triggers: LoopTriggerDraft[];
  notifications: LoopSchemas.LoopNotifications;
}

export function emptyLoopScheduleTriggerConfig(): LoopSchemas.LoopScheduleTriggerConfig {
  return { cron_expression: "0 9 * * *", timezone: "UTC" };
}

export function emptyLoopGithubTriggerConfig(): LoopSchemas.LoopGithubTriggerConfig {
  return { github_integration_id: 0, repository: "", events: [] };
}

export function emptyLoopApiTriggerConfig(): LoopSchemas.LoopApiTriggerConfig {
  return {};
}

export function defaultLoopNotifications(): LoopSchemas.LoopNotifications {
  const off = { enabled: false, events: [], params: {} };
  return { push: { ...off }, email: { ...off }, slack: { ...off } };
}

let draftKeySeq = 0;

export function nextDraftTriggerKey(): string {
  draftKeySeq += 1;
  return `draft-trigger-${draftKeySeq}`;
}

export function emptyLoopFormValues(): LoopFormValues {
  return {
    name: "",
    description: "",
    visibility: "personal",
    instructions: "",
    runtimeAdapter: "claude",
    model: "",
    reasoningEffort: null,
    repositories: [],
    triggers: [],
    notifications: defaultLoopNotifications(),
  };
}

export function loopToFormValues(loop: LoopSchemas.Loop): LoopFormValues {
  return {
    name: loop.name,
    description: loop.description,
    visibility: loop.visibility,
    instructions: loop.instructions,
    runtimeAdapter: loop.runtime_adapter,
    model: loop.model,
    reasoningEffort: loop.reasoning_effort,
    repositories: [...loop.repositories],
    triggers: loop.triggers.map((trigger) => ({
      key: trigger.id,
      id: trigger.id,
      type: trigger.type,
      enabled: trigger.enabled,
      config: trigger.config,
    })),
    notifications: loop.notifications,
  };
}

export function formValuesToLoopWrite(
  values: LoopFormValues,
): LoopSchemas.LoopWrite {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    visibility: values.visibility,
    instructions: values.instructions,
    runtime_adapter: values.runtimeAdapter,
    model: values.model.trim(),
    reasoning_effort: values.reasoningEffort,
    repositories: values.repositories,
    triggers: values.triggers.map((trigger) => ({
      id: trigger.id,
      type: trigger.type,
      enabled: trigger.enabled,
      config: trigger.config,
    })),
    notifications: values.notifications,
  };
}

export function isLoopFormValid(values: LoopFormValues): boolean {
  if (
    !values.name.trim() ||
    !values.instructions.trim() ||
    !values.model.trim()
  ) {
    return false;
  }
  return values.triggers.every((trigger) => isTriggerDraftValid(trigger));
}

export function isTriggerDraftValid(trigger: LoopTriggerDraft): boolean {
  if (trigger.type === "schedule") {
    const config = trigger.config as LoopSchemas.LoopScheduleTriggerConfig;
    return !!config.run_at || !!config.cron_expression;
  }
  if (trigger.type === "github") {
    const config = trigger.config as LoopSchemas.LoopGithubTriggerConfig;
    return (
      !!config.repository &&
      config.github_integration_id > 0 &&
      config.events.length > 0
    );
  }
  return true;
}
