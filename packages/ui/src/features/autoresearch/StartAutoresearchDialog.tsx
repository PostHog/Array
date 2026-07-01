import type { AutoresearchService } from "@posthog/core/autoresearch/autoresearch";
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

interface StartAutoresearchDialogProps {
  taskId: string;
  service: AutoresearchService;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StartAutoresearchDialog({
  taskId,
  service,
  open,
  onOpenChange,
}: StartAutoresearchDialogProps) {
  const [metricName, setMetricName] = useState("");
  const [direction, setDirection] = useState<AutoresearchDirection>("maximize");
  const [targetValue, setTargetValue] = useState("");
  const [maxIterations, setMaxIterations] = useState("10");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canStart =
    metricName.trim().length > 0 && instructions.trim().length > 0;

  const handleStart = () => {
    const target = targetValue.trim() === "" ? null : Number(targetValue);
    if (target !== null && !Number.isFinite(target)) {
      setError("Target must be a number.");
      return;
    }
    const iterations = Number.parseInt(maxIterations, 10);
    try {
      service.startRun({
        taskId,
        metricName,
        direction,
        targetValue: target,
        maxIterations: Number.isFinite(iterations) ? iterations : 10,
        instructions,
      });
      setError(null);
      onOpenChange(false);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Failed to start the run.",
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px" size="2">
        <Dialog.Title className="text-base">Start autoresearch</Dialog.Title>
        <Dialog.Description className="text-sm" color="gray">
          The agent will iterate on this task, measuring the metric after each
          change and reporting it back to the dashboard.
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
          <Button size="1" onClick={handleStart} disabled={!canStart}>
            Start run
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
