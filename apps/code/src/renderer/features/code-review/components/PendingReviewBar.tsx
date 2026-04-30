import { sendPromptToAgent } from "@features/sessions/utils/sendPromptToAgent";
import {
  CaretDown,
  CaretUp,
  PaperPlaneTilt,
  Trash,
} from "@phosphor-icons/react";
import { Badge, Button, Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import {
  type DraftComment,
  useReviewDraftsStore,
} from "../stores/reviewDraftsStore";
import { useReviewNavigationStore } from "../stores/reviewNavigationStore";
import { buildBatchedInlineCommentsPrompt } from "../utils/reviewPrompts";

interface PendingReviewBarProps {
  taskId: string;
}

function formatLineRef(d: DraftComment): string {
  const sideLabel = d.side === "deletions" ? "old" : "new";
  return d.startLine === d.endLine
    ? `L${d.startLine} ${sideLabel}`
    : `L${d.startLine}-${d.endLine} ${sideLabel}`;
}

export function PendingReviewBar({ taskId }: PendingReviewBarProps) {
  const drafts = useReviewDraftsStore((s) => s.drafts[taskId] ?? []);
  const clearDrafts = useReviewDraftsStore((s) => s.clearDrafts);
  const removeDraft = useReviewDraftsStore((s) => s.removeDraft);
  const requestScrollToFile = useReviewNavigationStore(
    (s) => s.requestScrollToFile,
  );

  const [collapsed, setCollapsed] = useState(false);

  if (drafts.length === 0) return null;

  const handleSend = () => {
    const prompt = buildBatchedInlineCommentsPrompt(drafts);
    if (!prompt) return;
    clearDrafts(taskId);
    sendPromptToAgent(taskId, prompt);
  };

  const countLabel = `${drafts.length} pending comment${drafts.length === 1 ? "" : "s"}`;

  return (
    <div className="shrink-0 border-(--gray-5) border-t bg-(--gray-2)">
      <Flex align="center" justify="between" gap="3" className="px-3 py-2">
        <Flex align="center" gap="2">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={
              collapsed ? "Expand pending review" : "Collapse pending review"
            }
          >
            {collapsed ? <CaretUp size={12} /> : <CaretDown size={12} />}
          </IconButton>
          <Badge color="iris" variant="soft" size="1">
            Pending review
          </Badge>
          <Text size="1" color="gray">
            {countLabel}
          </Text>
        </Flex>
        <Flex align="center" gap="2">
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => clearDrafts(taskId)}
          >
            Discard all
          </Button>
          <Button size="1" onClick={handleSend}>
            <PaperPlaneTilt size={12} weight="fill" />
            Send to agent
          </Button>
        </Flex>
      </Flex>
      {!collapsed && (
        <div className="max-h-48 overflow-auto border-(--gray-5) border-t">
          {drafts.map((d) => (
            <Flex
              key={d.id}
              align="start"
              justify="between"
              gap="2"
              className="border-(--gray-4) border-b px-3 py-1.5 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => requestScrollToFile(taskId, d.filePath)}
                className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
              >
                <Flex align="center" gap="2" className="mb-0.5">
                  <Text
                    size="1"
                    weight="medium"
                    className="truncate text-(--gray-12)"
                    title={d.filePath}
                  >
                    {d.filePath}
                  </Text>
                  <Text
                    size="1"
                    color="gray"
                    className="shrink-0 font-mono text-[11px]"
                  >
                    {formatLineRef(d)}
                  </Text>
                </Flex>
                <Text
                  as="div"
                  size="1"
                  color="gray"
                  className="line-clamp-2 whitespace-pre-wrap"
                >
                  {d.text}
                </Text>
              </button>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => removeDraft(taskId, d.id)}
                aria-label="Delete draft comment"
              >
                <Trash size={12} />
              </IconButton>
            </Flex>
          ))}
        </div>
      )}
    </div>
  );
}
