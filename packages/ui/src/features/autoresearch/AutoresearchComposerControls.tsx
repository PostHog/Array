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
} from "./stageModels";

interface AutoresearchComposerControlsProps {
  draft: AutoresearchDraftConfig;
  modelOptions: AutoresearchModelOption[];
  disabled?: boolean;
  onChange: (patch: Partial<AutoresearchDraftConfig>) => void;
  onExit: () => void;
}

/**
 * Autoresearch settings rendered inside the composer box (its header addon)
 * while the mode is armed — one input view, not a widget attached under it.
 * There is deliberately no metric or instructions field: the prompt IS the
 * optimization brief, and the agent names the metric in its reports.
 */
export function AutoresearchComposerControls({
  draft,
  modelOptions,
  disabled = false,
  onChange,
  onExit,
}: AutoresearchComposerControlsProps) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      <span className="flex shrink-0 items-center gap-1 font-medium text-violet-11">
        <ChartLineUp size={13} />
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
      <span className="flex items-center gap-1 text-(--gray-11)">
        ≤
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
          aria-label="Iteration budget"
          disabled={disabled}
        />
        iterations
      </span>
      {modelOptions.length > 0 && (
        <StageModelsPopover
          draft={draft}
          modelOptions={modelOptions}
          disabled={disabled}
          onChange={onChange}
        />
      )}
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

/**
 * Optional per-stage models, tucked behind a popover so the inline row stays
 * at the three inputs that matter (direction, target, budget).
 */
function StageModelsPopover({
  draft,
  modelOptions,
  disabled,
  onChange,
}: {
  draft: AutoresearchDraftConfig;
  modelOptions: AutoresearchModelOption[];
  disabled: boolean;
  onChange: (patch: Partial<AutoresearchDraftConfig>) => void;
}) {
  const armed = draft.implementModel !== null || draft.measureModel !== null;

  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button
          size="1"
          variant="ghost"
          color={armed ? "violet" : "gray"}
          disabled={disabled}
          aria-label="Stage models"
        >
          <SlidersHorizontal size={12} />
          {armed ? "Stage models on" : "Stage models"}
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1" width="300px">
        <div className="flex flex-col gap-2">
          <div>
            <Text as="label" size="1" weight="medium" className="mb-1 block">
              Build model
            </Text>
            <StageModelSelect
              noneLabel="Task model"
              value={draft.implementModel}
              options={modelOptions}
              className="w-full"
              onChange={(value) => onChange({ implementModel: value })}
            />
          </div>
          <div>
            <Text as="label" size="1" weight="medium" className="mb-1 block">
              Measure model
            </Text>
            <StageModelSelect
              noneLabel="Task model"
              value={draft.measureModel}
              options={modelOptions}
              className="w-full"
              onChange={(value) => onChange({ measureModel: value })}
            />
          </div>
          <Text size="1" color="gray">
            With stage models, each iteration ideates and builds on one model
            and runs the measurement on the other — pick a cheap one for
            measuring.
          </Text>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
