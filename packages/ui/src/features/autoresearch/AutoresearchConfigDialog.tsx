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

export interface AutoresearchConfigValues {
  metricName: string;
  direction: AutoresearchDirection;
  targetValue: number | null;
  maxIterations: number;
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
          initial={initial}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

interface FormValues {
  metricName: string;
  direction: AutoresearchDirection;
  targetValue: string;
  maxIterations: string;
  instructions: string;
}

function ConfigForm({
  submitLabel,
  showInstructions,
  initial,
  onSubmit,
  onDone,
}: {
  submitLabel: string;
  showInstructions: boolean;
  initial?: Partial<AutoresearchConfigValues>;
  onSubmit: (values: AutoresearchConfigValues) => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<FormValues>(() => ({
    metricName: initial?.metricName ?? "",
    direction: initial?.direction ?? "maximize",
    targetValue:
      initial?.targetValue != null ? String(initial.targetValue) : "",
    maxIterations: String(initial?.maxIterations ?? 10),
    instructions: initial?.instructions ?? "",
  }));
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) => setValues((current) => ({ ...current, [field]: value }));

  const canSubmit =
    values.metricName.trim().length > 0 &&
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
        metricName: values.metricName.trim(),
        direction: values.direction,
        targetValue: target,
        maxIterations: Number.isFinite(iterations) ? iterations : 10,
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
        <div>
          <Text
            as="label"
            htmlFor="autoresearch-metric"
            size="1"
            weight="medium"
            className="mb-1 block"
          >
            Metric
          </Text>
          <TextField.Root
            id="autoresearch-metric"
            value={values.metricName}
            onChange={(event) => setField("metricName", event.target.value)}
            placeholder="e.g. bundle size (kB), requests/sec, test coverage %"
          />
        </div>

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

        {showInstructions && (
          <div>
            <Text
              as="label"
              htmlFor="autoresearch-instructions"
              size="1"
              weight="medium"
              className="mb-1 block"
            >
              Instructions
            </Text>
            <TextArea
              id="autoresearch-instructions"
              value={values.instructions}
              onChange={(event) => setField("instructions", event.target.value)}
              placeholder="What to optimize, how to measure the metric, and any constraints to respect."
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
