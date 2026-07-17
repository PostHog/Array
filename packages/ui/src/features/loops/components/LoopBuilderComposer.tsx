import { ArrowUpIcon } from "@phosphor-icons/react";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useLoopBuilderTask } from "../hooks/useLoopBuilderTask";

const EXAMPLE_PROMPTS = [
  "Summarize my open PRs every weekday morning",
  "Triage new issues and flag duplicates",
  "Draft release notes when a PR merges to main",
];

/** The "describe what you want and an agent builds it" prompt box. Shared by the main
 * Loops page and a context's Loops tab; passing `context` attaches the built loop to it. */
export function LoopBuilderComposer({
  context,
}: {
  context?: { folderId: string; name: string };
}) {
  const [prompt, setPrompt] = useState("");
  const { runTask, isRunning } = useLoopBuilderTask(context);

  const start = () => {
    const text = prompt.trim();
    if (!text || isRunning) return;
    void runTask(text);
  };

  return (
    <Flex direction="column" gap="2">
      <Flex gap="2" wrap="wrap">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setPrompt(example)}
            className="rounded-full border border-gray-5 bg-gray-2 px-3 py-1 text-gray-11 text-xs transition-colors hover:border-gray-7 hover:bg-gray-3"
          >
            {example}
          </button>
        ))}
      </Flex>
      <Flex
        direction="column"
        gap="2"
        className="rounded-(--radius-4) border border-border bg-(--color-panel-solid) p-3 transition-colors focus-within:border-(--gray-8)"
      >
        <textarea
          value={prompt}
          rows={2}
          disabled={isRunning}
          placeholder={
            context
              ? `What should this loop automate for #${context.name}?`
              : "What do you want automated?"
          }
          className="w-full resize-none bg-transparent text-[13px] text-gray-12 leading-relaxed outline-none placeholder:text-gray-9 disabled:opacity-60"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              start();
            }
          }}
        />
        <Flex align="center" justify="between" gap="3">
          <Text className="text-[11px] text-gray-9">
            An agent builds the loop with you, then creates it on your
            confirmation
          </Text>
          <IconButton
            variant="solid"
            size="1"
            aria-label="Build loop with an agent"
            loading={isRunning}
            disabled={!prompt.trim() || isRunning}
            onClick={start}
          >
            <ArrowUpIcon size={13} weight="bold" />
          </IconButton>
        </Flex>
      </Flex>
    </Flex>
  );
}
