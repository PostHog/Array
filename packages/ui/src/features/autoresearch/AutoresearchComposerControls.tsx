import { ChartLineUp, SlidersHorizontal, X } from "@phosphor-icons/react";
import type {
  AutoresearchDirection,
  AutoresearchDraftConfig,
} from "@posthog/core/autoresearch/schemas";
import { Button, Popover, Select, Text, TextField } from "@radix-ui/themes";
import { Tooltip } from "../../primitives/Tooltip";
import {
  type AutoresearchModelOption,
  clampMaxIterations,
  StageModelSelect,
  stageValueLabel,
} from "./stageModels";

interface AutoresearchComposerControlsProps {
  draft: AutoresearchDraftConfig;
  modelOptions: AutoresearchModelOption[];
  effortOptions: AutoresearchModelOption[];
  disabled?: boolean;
  onChange: (patch: Partial<AutoresearchDraftConfig>) => void;
  onExit: () => void;
}

/**
 * Autoresearch settings shown as a bar above the composer while the mode is
 * armed. It reads as one sentence — "Optimize to maximize until it reaches N
 * or after K iterations using <model>" — so each control explains itself in
 * place; tooltips on the labels add the detail.
 *
 * There is deliberately no metric or instructions field: the prompt IS the
 * optimization brief, and the agent names the metric in its reports.
 *
 * While armed, the composer's own model/effort pickers are hidden and the
 * stage popover here is the single place models and efforts are chosen.
 */
export function AutoresearchComposerControls({
  draft,
  modelOptions,
  effortOptions,
  disabled = false,
  onChange,
  onExit,
}: AutoresearchComposerControlsProps) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
      <Tooltip content="Runs an autonomous optimization loop: it measures a baseline from your brief, then edits the code and re-measures each round — keeping changes that move the metric and reverting the ones that don't. It stops when the metric reaches your target or hits the iteration cap, whichever comes first.">
        <span className="flex shrink-0 cursor-help items-center gap-1 font-medium text-violet-11">
          <ChartLineUp size={13} />
          Autoresearch
        </span>
      </Tooltip>

      {/* The goal: which way to push the metric the brief describes. */}
      <span className="flex items-center gap-1.5 whitespace-nowrap text-(--gray-11)">
        <Tooltip content="Whether the agent should drive the metric from your brief up or down.">
          <span className="cursor-help">Optimize to</span>
        </Tooltip>
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
            <Select.Item value="maximize">maximize</Select.Item>
            <Select.Item value="minimize">minimize</Select.Item>
          </Select.Content>
        </Select.Root>
      </span>

      {/* Two stop conditions, whichever comes first: the metric hits the
          target value, or the run exhausts its iteration budget. Only the
          label text is wrapped in a tooltip — never the input — so focusing
          the field to type doesn't pop the tooltip open. */}
      <span className="flex items-center gap-1.5 whitespace-nowrap text-(--gray-11)">
        <Tooltip content="Finish early once the metric reaches this value. Leave blank to always run the full iteration budget.">
          <span className="cursor-help">until it reaches</span>
        </Tooltip>
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
          placeholder="optional"
          inputMode="decimal"
          aria-label="Target metric value to stop at (optional)"
          disabled={disabled}
        />
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-(--gray-11)">
        or after
        <TextField.Root
          size="1"
          className="w-14"
          value={String(draft.maxIterations)}
          onChange={(event) =>
            onChange({
              maxIterations: clampMaxIterations(
                Number.parseInt(event.target.value, 10),
              ),
            })
          }
          inputMode="numeric"
          aria-label="Maximum iterations"
          disabled={disabled}
        />
        <Tooltip content="Hard cap on build-and-measure rounds before the run stops.">
          <span className="cursor-help">iterations</span>
        </Tooltip>
      </span>

      {/* The engine: model + effort per stage. */}
      <span className="flex items-center gap-1.5 whitespace-nowrap text-(--gray-11)">
        <Tooltip content="Model and reasoning effort the loop runs on. Set the build and measure stages to different models to measure with a cheaper one.">
          <span className="cursor-help">using</span>
        </Tooltip>
        <StagesPopover
          draft={draft}
          modelOptions={modelOptions}
          effortOptions={effortOptions}
          disabled={disabled}
          onChange={onChange}
        />
      </span>

      <span className="ml-auto flex shrink-0 items-center">
        <Tooltip content="Exit autoresearch mode">
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit autoresearch mode"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-(--gray-10) hover:bg-(--gray-4) hover:text-(--gray-12)"
          >
            <X size={12} />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

function stageSummary(
  model: string | null,
  effort: string | null,
  modelOptions: AutoresearchModelOption[],
  effortOptions: AutoresearchModelOption[],
): string {
  const modelLabel = stageValueLabel(model, modelOptions) ?? "task model";
  const effortLabel = stageValueLabel(effort, effortOptions);
  return effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel;
}

/**
 * Per-stage model and effort. While autoresearch is armed this popover is
 * the composer's only model/effort control, so the trigger always shows a
 * summary of what the run will use. Identical stages mean single-turn
 * iterations; any difference splits each iteration into a build turn and a
 * measure turn, switching between the stages.
 */
function StagesPopover({
  draft,
  modelOptions,
  effortOptions,
  disabled,
  onChange,
}: {
  draft: AutoresearchDraftConfig;
  modelOptions: AutoresearchModelOption[];
  effortOptions: AutoresearchModelOption[];
  disabled: boolean;
  onChange: (patch: Partial<AutoresearchDraftConfig>) => void;
}) {
  const split =
    draft.implementModel !== draft.measureModel ||
    draft.implementEffort !== draft.measureEffort;
  const buildSummary = stageSummary(
    draft.implementModel,
    draft.implementEffort,
    modelOptions,
    effortOptions,
  );
  const measureSummary = stageSummary(
    draft.measureModel,
    draft.measureEffort,
    modelOptions,
    effortOptions,
  );

  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button
          size="1"
          variant="ghost"
          color={split ? "violet" : "gray"}
          disabled={disabled}
          aria-label="Stage models and effort"
        >
          <SlidersHorizontal size={12} />
          {split ? `${buildSummary} → ${measureSummary}` : buildSummary}
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1" width="320px">
        <div className="flex flex-col gap-3">
          <StageFields
            legend="Implementation (ideate & build)"
            model={draft.implementModel}
            effort={draft.implementEffort}
            modelOptions={modelOptions}
            effortOptions={effortOptions}
            onModelChange={(value) => onChange({ implementModel: value })}
            onEffortChange={(value) => onChange({ implementEffort: value })}
          />
          <StageFields
            legend="Experiment (measure)"
            model={draft.measureModel}
            effort={draft.measureEffort}
            modelOptions={modelOptions}
            effortOptions={effortOptions}
            onModelChange={(value) => onChange({ measureModel: value })}
            onEffortChange={(value) => onChange({ measureEffort: value })}
          />
          <Text size="1" color="gray">
            Identical stages run each iteration as one turn. Different stages
            split every iteration: build on the first, measure on the second —
            pick a cheap model or low effort for measuring.
          </Text>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

function StageFields({
  legend,
  model,
  effort,
  modelOptions,
  effortOptions,
  onModelChange,
  onEffortChange,
}: {
  legend: string;
  model: string | null;
  effort: string | null;
  modelOptions: AutoresearchModelOption[];
  effortOptions: AutoresearchModelOption[];
  onModelChange: (value: string | null) => void;
  onEffortChange: (value: string | null) => void;
}) {
  return (
    <div>
      <Text as="div" size="1" weight="medium" className="mb-1">
        {legend}
      </Text>
      <div className="flex gap-2">
        <StageModelSelect
          className="flex-1"
          ariaLabel={`${legend} model`}
          noneLabel="Task model"
          value={model}
          options={modelOptions}
          onChange={onModelChange}
        />
        {effortOptions.length > 0 && (
          <StageModelSelect
            className="w-28"
            ariaLabel={`${legend} effort`}
            noneLabel="Default effort"
            value={effort}
            options={effortOptions}
            onChange={onEffortChange}
          />
        )}
      </div>
    </div>
  );
}
