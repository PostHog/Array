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
import { useEffect, useState } from "react";

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
  const [metricName, setMetricName] = useState("");
  const [direction, setDirection] = useState<AutoresearchDirection>("maximize");
  const [targetValue, setTargetValue] = useState("");
  const [maxIterations, setMaxIterations] = useState("10");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMetricName(initial?.metricName ?? "");
    setDirection(initial?.direction ?? "maximize");
    setTargetValue(
      initial?.targetValue != null ? String(initial.targetValue) : "",
    );
    setMaxIterations(String(initial?.maxIterations ?? 10));
    setInstructions(initial?.instructions ?? "");
    setError(null);
  }, [open, initial]);

  const canSubmit =
    metricName.trim().length > 0 &&
    (!showInstructions || instructions.trim().length > 0);

  const handleSubmit = () => {
    const target = targetValue.trim() === "" ? null : Number(targetValue);
    if (target !== null && !Number.isFinite(target)) {
      setError("Target must be a number.");
      return;
    }
    const iterations = Number.parseInt(maxIterations, 10);
    try {
      onSubmit({
        metricName: metricName.trim(),
        direction,
        targetValue: target,
        maxIterations: Number.isFinite(iterations) ? iterations : 10,
        instructions: showInstructions ? instructions : undefined,
      });
      setError(null);
      onOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to apply the configuration.",
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px" size="2">
        <Dialog.Title className="text-base">{title}</Dialog.Title>
        <Dialog.Description className="text-sm" color="gray">
          {description}
        </Dialog.Description>

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
              value={metricName}
              onChange={(event) => setMetricName(event.target.value)}
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
                value={direction}
                onValueChange={(value) =>
                  setDirection(value as AutoresearchDirection)
                }
              >
                <Select.Trigger
                  id="autoresearch-direction"
                  className="w-full"
                />
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
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
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
                value={maxIterations}
                onChange={(event) => setMaxIterations(event.target.value)}
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
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
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
      </Dialog.Content>
    </Dialog.Root>
  );
}
