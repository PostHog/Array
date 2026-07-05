import { CaretDown, CaretRight, CheckCircle } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { PlanContent } from "../../../permissions/PlanContent";
import { type ToolViewProps, useToolCallStatus } from "./toolCallUtils";

export function PlanApprovalView({
  toolCall,
  turnCancelled,
  turnComplete,
}: ToolViewProps) {
  const { content } = toolCall;
  const { isComplete, wasCancelled } = useToolCallStatus(
    toolCall.status,
    turnCancelled,
    turnComplete,
  );
  const [isPlanExpanded, setIsPlanExpanded] = useState(false);

  const planText = useMemo(() => {
    const rawPlan = (toolCall.rawInput as { plan?: string } | undefined)?.plan;
    if (rawPlan) return rawPlan;

    if (!content || content.length === 0) return null;
    const textContent = content.find((c) => c.type === "content");
    if (textContent && "content" in textContent) {
      const inner = textContent.content as
        | { type?: string; text?: string }
        | undefined;
      if (inner?.type === "text" && inner.text) {
        return inner.text;
      }
    }
    return null;
  }, [content, toolCall.rawInput]);

  const showResult = isComplete || wasCancelled;
  const canTogglePlan = showResult && !!planText;
  const planContentId = `plan-content-${toolCall.toolCallId}`;

  if (!planText && !showResult) return null;

  const statusContent = isComplete ? (
    <>
      <CheckCircle size={14} weight="fill" className="text-green-9" />
      <Text className="text-[13px] text-green-11">
        Plan approved — proceeding with implementation
      </Text>
    </>
  ) : wasCancelled ? (
    <Text className="text-[13px] text-gray-10">(Plan rejected)</Text>
  ) : null;

  return (
    <Box className="my-3">
      {!showResult && planText && (
        <PlanContent id={toolCall.toolCallId} plan={planText} />
      )}

      {showResult && (
        <Box>
          {canTogglePlan ? (
            <button
              type="button"
              onClick={() => setIsPlanExpanded((v) => !v)}
              aria-expanded={isPlanExpanded}
              aria-controls={planContentId}
              className="flex items-center gap-2 rounded-sm px-1 text-left hover:bg-gray-3"
            >
              {isPlanExpanded ? (
                <CaretDown size={12} className="text-gray-10" />
              ) : (
                <CaretRight size={12} className="text-gray-10" />
              )}
              {statusContent}
              <Text className="text-[13px] text-gray-10">
                · {isPlanExpanded ? "hide plan" : "show plan"}
              </Text>
            </button>
          ) : (
            <Flex align="center" gap="2" className="px-1">
              {statusContent}
            </Flex>
          )}

          {canTogglePlan && isPlanExpanded && (
            <Box id={planContentId} className="mt-2">
              <PlanContent id={toolCall.toolCallId} plan={planText} />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
