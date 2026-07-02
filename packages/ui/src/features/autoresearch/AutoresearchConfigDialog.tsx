import type { AutoresearchDirection } from "@posthog/core/autoresearch/schemas";
import {
  Button,
  Dialog,
  Flex,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";

/** Sentinel for "no stage model" — Radix Select items can't be empty. */
const SINGLE_TURN = "__single_turn__";

export interface AutoresearchModelOption {
  value: string;
  label: string;
}

export interface AutoresearchConfigValues {
  direction: AutoresearchDirection;
  targetValue: number | null;
  maxIterations: number;
  implementModel: string | null;
  measureModel: string | null;
  instructions?: string;
}

interface AutoresearchConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  /** Show the instructions field (dashboard re-runs); the create-task flow takes instructions from the composer prompt instead. */
  showInstructions?: boolean;
  /** Session model options for the stage-model selects; hidden when empty. */
  modelOptions?: AutoresearchModelOption[];
  initial?: Partial<AutoresearchConfigValues>;
  /** May throw — the message is shown inline and the dialog stays open. */
  onSubmit: (values: AutoresearchConfigValues) => void;
}

export function AutoresearchConfigDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  showInstructions = false,
  modelOptions = [],
  initial,
  onSubmit,
}: AutoresearchConfigDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px" size="2">
        <Dialog.Title className="text-base">{title}</Dialog.Title>
        <Dialog.Description className="text-sm" color="gray">
          {description}
        </Dialog.Description>
        {/* Radix unmounts closed dialog content, so the form mounts fresh
            (seeded from the current `initial`) on every open. */}
        <ConfigForm
          submitLabel={submitLabel}
          showInstructions={showInstructions}
          modelOptions={modelOptions}
          initial={initial}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

interface FormValues {
  direction: AutoresearchDirection;
  targetValue: string;
  maxIterations: string;
  implementModel: string;
  measureModel: string;
  instructions: string;
}

function ConfigForm({
  submitLabel,
  showInstructions,
  modelOptions,
  initial,
  onSubmit,
  onDone,
}: {
  submitLabel: string;
  showInstructions: boolean;
  modelOptions: AutoresearchModelOption[];
  initial?: Partial<AutoresearchConfigValues>;
  onSubmit: (values: AutoresearchConfigValues) => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<FormValues>(() => ({
    direction: initial?.direction ?? "maximize",
    targetValue:
      initial?.targetValue != null ? String(initial.targetValue) : "",
    maxIterations: String(initial?.maxIterations ?? 10),
    implementModel: initial?.implementModel ?? SINGLE_TURN,
    measureModel: initial?.measureModel ?? SINGLE_TURN,
    instructions: initial?.instructions ?? "",
  }));
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) => setValues((current) => ({ ...current, [field]: value }));

  const stageModelsMismatched =
    (values.implementModel === SINGLE_TURN) !==
    (values.measureModel === SINGLE_TURN);

  const canSubmit =
    !stageModelsMismatched &&
    (!showInstructions || values.instructions.trim().length > 0);

  const handleSubmit = () => {
    const target =
      values.targetValue.trim() === "" ? null : Number(values.targetValue);
    if (target !== null && !Number.isFinite(target)) {
      setError("Target must be a number.");
      return;
    }
    const iterations = Number.parseInt(values.maxIterations, 10);
    try {
      onSubmit({
        direction: values.direction,
        targetValue: target,
        maxIterations: Number.isFinite(iterations) ? iterations : 10,
        implementModel:
          values.implementModel === SINGLE_TURN ? null : values.implementModel,
        measureModel:
          values.measureModel === SINGLE_TURN ? null : values.measureModel,
        instructions: showInstructions ? values.instructions : undefined,
      });
      setError(null);
      onDone();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to apply the configuration.",
      );
    }
  };

  return (
    <>
      <Flex direction="column" gap="3" mt="4">
        <Flex gap="3">
          <div className="flex-1">
            <Text
              as="label"
              htmlFor="autoresearch-direction"
              size="1"
              weight="medium"
              className="mb-1 block"
            >
              Direction
            </Text>
            <Select.Root
              value={values.direction}
              onValueChange={(value) =>
                setField("direction", value as AutoresearchDirection)
              }
            >
              <Select.Trigger id="autoresearch-direction" className="w-full" />
              <Select.Content>
                <Select.Item value="maximize">Maximize</Select.Item>
                <Select.Item value="minimize">Minimize</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          <div className="flex-1">
            <Text
              as="label"
              htmlFor="autoresearch-target"
              size="1"
              weight="medium"
              className="mb-1 block"
            >
              Target (optional)
            </Text>
            <TextField.Root
              id="autoresearch-target"
              value={values.targetValue}
              onChange={(event) => setField("targetValue", event.target.value)}
              placeholder="Stop early at…"
              inputMode="decimal"
            />
          </div>
          <div className="w-28">
            <Text
              as="label"
              htmlFor="autoresearch-iterations"
              size="1"
              weight="medium"
              className="mb-1 block"
            >
              Iterations
            </Text>
            <TextField.Root
              id="autoresearch-iterations"
              value={values.maxIterations}
              onChange={(event) =>
                setField("maxIterations", event.target.value)
              }
              inputMode="numeric"
            />
          </div>
        </Flex>

        {modelOptions.length > 0 && (
          <div>
            <Flex gap="3">
              <StageModelSelect
                id="autoresearch-implement-model"
                label="Build model"
                value={values.implementModel}
                options={modelOptions}
                onChange={(value) => setField("implementModel", value)}
              />
              <StageModelSelect
                id="autoresearch-measure-model"
                label="Measure model"
                value={values.measureModel}
                options={modelOptions}
                onChange={(value) => setField("measureModel", value)}
              />
            </Flex>
            <Text
              as="div"
              size="1"
              color={stageModelsMismatched ? "red" : "gray"}
              mt="1"
            >
              {stageModelsMismatched
                ? "Set both stage models, or leave both on single turn."
                : "With stage models, each iteration ideates on the build model and measures on the measure model."}
            </Text>
          </div>
        )}

        {showInstructions && (
          <div>
            <Text
              as="label"
              htmlFor="autoresearch-instructions"
              size="1"
              weight="medium"
              className="mb-1 block"
            >
              Optimization brief
            </Text>
            <TextArea
              id="autoresearch-instructions"
              value={values.instructions}
              onChange={(event) => setField("instructions", event.target.value)}
              placeholder="What to optimize, how to measure it, and any constraints to respect."
              rows={4}
            />
          </div>
        )}

        {error && (
          <Text size="1" color="red">
            {error}
          </Text>
        )}
      </Flex>

      <Flex justify="end" gap="2" mt="4">
        <Dialog.Close>
          <Button variant="soft" color="gray" size="1">
            Cancel
          </Button>
        </Dialog.Close>
        <Button size="1" onClick={handleSubmit} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </Flex>
    </>
  );
}

function StageModelSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: AutoresearchModelOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex-1">
      <Text
        as="label"
        htmlFor={id}
        size="1"
        weight="medium"
        className="mb-1 block"
      >
        {label}
      </Text>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger id={id} className="w-full" />
        <Select.Content>
          <Select.Item value={SINGLE_TURN}>Single turn (default)</Select.Item>
          {options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </div>
  );
}
