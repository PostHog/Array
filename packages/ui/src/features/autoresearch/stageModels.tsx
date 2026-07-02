import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { AUTORESEARCH_MAX_ITERATIONS_LIMIT } from "@posthog/core/autoresearch/schemas";
import { Select } from "@radix-ui/themes";
import { flattenSelectOptions } from "../sessions/sessionStore";

/** A session model choice offered for a stage: value plus a display label. */
export interface AutoresearchModelOption {
  value: string;
  label: string;
}

/**
 * Sentinel for "no stage model" — Radix `Select.Item` cannot have an empty
 * value, so the "leave the session model alone" choice needs a placeholder.
 * Shared so the composer strip and the dashboard dialog can't drift onto
 * different sentinels.
 */
export const NO_STAGE_MODEL = "__no_stage_model__";

/** Derive stage-model options from a session's `model` config option. */
export function toAutoresearchModelOptions(
  modelOption: SessionConfigOption | undefined,
): AutoresearchModelOption[] {
  if (modelOption?.type !== "select") return [];
  return flattenSelectOptions(modelOption.options).map((option) => ({
    value: option.value,
    label: option.name ?? option.value,
  }));
}

/** Map a select value back to the stored stage model (null = leave alone). */
export function stageModelFromSelectValue(value: string): string | null {
  return value === NO_STAGE_MODEL ? null : value;
}

/** Map a stored stage model to a non-empty select value. */
export function selectValueFromStageModel(model: string | null): string {
  return model ?? NO_STAGE_MODEL;
}

/** Clamp a user-entered iteration budget to the range the core schema accepts. */
export function clampMaxIterations(value: number): number {
  if (!Number.isFinite(value)) return 10;
  const rounded = Math.trunc(value);
  if (rounded < 1) return 1;
  if (rounded > AUTORESEARCH_MAX_ITERATIONS_LIMIT) {
    return AUTORESEARCH_MAX_ITERATIONS_LIMIT;
  }
  return rounded;
}

/**
 * The stage-model dropdown shared by the composer strip and the config
 * dialog: a sentinel-safe Radix select whose "none" option and chrome the
 * caller styles via props.
 */
export function StageModelSelect({
  value,
  options,
  onChange,
  noneLabel,
  ariaLabel,
  id,
  size,
  variant,
  className,
  disabled,
}: {
  value: string | null;
  options: AutoresearchModelOption[];
  onChange: (value: string | null) => void;
  noneLabel: string;
  ariaLabel?: string;
  id?: string;
  size?: "1" | "2" | "3";
  variant?: "surface" | "soft";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select.Root
      size={size}
      value={selectValueFromStageModel(value)}
      onValueChange={(next) => onChange(stageModelFromSelectValue(next))}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        variant={variant}
        className={className}
        aria-label={ariaLabel}
      />
      <Select.Content>
        <Select.Item value={NO_STAGE_MODEL}>{noneLabel}</Select.Item>
        {options.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
