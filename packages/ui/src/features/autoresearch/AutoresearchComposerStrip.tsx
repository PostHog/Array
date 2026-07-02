import { ChartLineUp, X } from "@phosphor-icons/react";
import type {
  AutoresearchDirection,
  AutoresearchDraftConfig,
} from "@posthog/core/autoresearch/schemas";
import { Select, TextField } from "@radix-ui/themes";
import { Tooltip } from "../../primitives/Tooltip";
import type { AutoresearchModelOption } from "./AutoresearchConfigDialog";

/** Sentinel for "no stage model" — Radix Select items can't be empty. */
const TASK_MODEL = "__task_model__";

interface AutoresearchComposerStripProps {
  draft: AutoresearchDraftConfig;
  modelOptions: AutoresearchModelOption[];
  disabled?: boolean;
  onChange: (patch: Partial<AutoresearchDraftConfig>) => void;
  onExit: () => void;
}

/**
 * Inline autoresearch settings attached under the new-task composer while
 * the mode is armed. There is deliberately no metric or instructions input
 * here: the prompt IS the optimization brief, and the agent names the
 * metric in its reports.
 */
export function AutoresearchComposerStrip({
  draft,
  modelOptions,
  disabled = false,
  onChange,
  onExit,
}: AutoresearchComposerStripProps) {
  return (
    <div className="-mt-px mx-2 flex select-none flex-col gap-1 rounded-b-md border border-violet-6 border-t-0 bg-violet-2 px-2 py-1.5 text-[12px] text-violet-11">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex shrink-0 items-center gap-1 font-medium">
          <ChartLineUp size={12} />
          Autoresearch
        </span>
        <Select.Root
          size="1"
          value={draft.direction}
          onValueChange={(value) =>
            onChange({ direction: value as AutoresearchDirection })
          }
          disabled={disabled}
        >
          <Select.Trigger variant="soft" aria-label="Optimization direction" />
          <Select.Content>
            <Select.Item value="maximize">Maximize</Select.Item>
            <Select.Item value="minimize">Minimize</Select.Item>
          </Select.Content>
        </Select.Root>
        <TextField.Root
          size="1"
          className="w-24"
          value={draft.targetValue === null ? "" : String(draft.targetValue)}
          onChange={(event) => {
            const raw = event.target.value.trim();
            const numeric = Number(raw);
            onChange({
              targetValue:
                raw === "" || !Number.isFinite(numeric) ? null : numeric,
            });
          }}
          placeholder="Target"
          inputMode="decimal"
          aria-label="Target value (optional)"
          disabled={disabled}
        />
        <span className="flex items-center gap-1">
          ≤
          <TextField.Root
            size="1"
            className="w-14"
            value={String(draft.maxIterations)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({
                maxIterations:
                  Number.isFinite(parsed) && parsed > 0 ? parsed : 10,
              });
            }}
            inputMode="numeric"
            aria-label="Iteration budget"
            disabled={disabled}
          />
          iterations
        </span>
        {modelOptions.length > 0 && (
          <>
            <StageModelSelect
              label="Build"
              value={draft.implementModel}
              options={modelOptions}
              disabled={disabled}
              onChange={(value) => onChange({ implementModel: value })}
            />
            <StageModelSelect
              label="Measure"
              value={draft.measureModel}
              options={modelOptions}
              disabled={disabled}
              onChange={(value) => onChange({ measureModel: value })}
            />
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          <Tooltip content="Exit autoresearch mode">
            <button
              type="button"
              onClick={onExit}
              aria-label="Exit autoresearch mode"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-violet-10 hover:bg-violet-4 hover:text-violet-12"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </span>
      </div>
      <span className="text-violet-10">
        Your prompt is the optimization brief — say what to optimize, how to
        measure it, and any constraints. The agent measures a baseline first,
        then iterates.
      </span>
    </div>
  );
}

function StageModelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  options: AutoresearchModelOption[];
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      {label}
      <Select.Root
        size="1"
        value={value ?? TASK_MODEL}
        onValueChange={(next) => onChange(next === TASK_MODEL ? null : next)}
        disabled={disabled}
      >
        <Select.Trigger variant="soft" aria-label={`${label} stage model`} />
        <Select.Content>
          <Select.Item value={TASK_MODEL}>Task model</Select.Item>
          {options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </span>
  );
}
