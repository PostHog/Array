import { Brain } from "@phosphor-icons/react";
import { memo } from "react";
import { ToolRow } from "./ToolRow";
import { ContentPre } from "./toolCallUtils";

interface ThoughtViewProps {
  content: string;
  isLoading: boolean;
}

export const ThoughtView = memo(function ThoughtView({
  content,
  isLoading,
}: ThoughtViewProps) {
  const hasContent = content.trim().length > 0;

  return (
    <div className="pl-3">
      <ToolRow
        icon={Brain}
        isLoading={isLoading}
        content={hasContent ? <ContentPre>{content}</ContentPre> : undefined}
      >
        Thinking
      </ToolRow>
    </div>
  );
});
