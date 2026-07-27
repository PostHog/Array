import type { LoopSchemas } from "@posthog/api-client/loops";
import { Button } from "@posthog/quill";
import { toast } from "@posthog/ui/primitives/toast";
import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import { useUpdateLoop } from "../hooks/useLoopMutations";
import { LoopModelFields } from "./LoopModelFields";

export function InlineLoopModelEditor({ loop }: { loop: LoopSchemas.Loop }) {
  const [adapter, setAdapter] = useState<LoopSchemas.LoopRuntimeAdapterEnum>(
    loop.runtime_adapter,
  );
  const [model, setModel] = useState(loop.model);
  const [reasoningEffort, setReasoningEffort] =
    useState<LoopSchemas.LoopReasoningEffortEnum | null>(loop.reasoning_effort);
  const updateLoop = useUpdateLoop(loop.id);

  const save = async () => {
    try {
      await updateLoop.mutateAsync({
        runtime_adapter: adapter,
        model,
        reasoning_effort: reasoningEffort,
      });
      toast.success("Model configuration updated");
    } catch (error) {
      toast.error("Failed to update model configuration", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <Flex direction="column" gap="3" className="w-full py-1">
      <LoopModelFields
        adapter={adapter}
        model={model}
        reasoningEffort={reasoningEffort}
        onAdapterChange={setAdapter}
        onModelChange={setModel}
        onReasoningEffortChange={setReasoningEffort}
        disabled={updateLoop.isPending}
        inline
      />
      <Flex justify="end">
        <Button
          variant="primary"
          size="sm"
          loading={updateLoop.isPending}
          onClick={() => void save()}
        >
          Save model configuration
        </Button>
      </Flex>
    </Flex>
  );
}
