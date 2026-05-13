import { PlanContent } from "@components/permissions/PlanContent";
import { CaretDown, CaretRight, CheckCircle } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
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
  const showPlanInline = !showResult;
  const canTogglePlan = showResult && !!planText;

  if (!planText && !showResult) return null;

  return (
    <Box className="my-3">
      {showPlanInline && planText && (
        <PlanContent id={toolCall.toolCallId} plan={planText} />
      )}

      {showResult && (
        <Box>
          <Flex
            align="center"
            gap="2"
            className={`px-1 ${canTogglePlan ? "cursor-pointer select-none" : ""}`}
            onClick={
              canTogglePlan ? () => setIsPlanExpanded((v) => !v) : undefined
            }
          >
            {canTogglePlan &&
              (isPlanExpanded ? (
                <CaretDown size={10} className="text-gray-10" />
              ) : (
                <CaretRight size={10} className="text-gray-10" />
              ))}
            {isComplete ? (
              <>
                <CheckCircle size={14} weight="fill" className="text-green-9" />
                <Text className="text-[13px] text-green-11">
                  Plan approved — proceeding with implementation
                </Text>
              </>
            ) : wasCancelled ? (
              <Text className="text-[13px] text-gray-10">(Plan rejected)</Text>
            ) : null}
            {canTogglePlan && (
              <Text className="text-[13px] text-gray-9">
                · {isPlanExpanded ? "hide plan" : "show plan"}
              </Text>
            )}
          </Flex>

          {canTogglePlan && isPlanExpanded && (
            <Box className="mt-2">
              <PlanContent id={toolCall.toolCallId} plan={planText} />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
