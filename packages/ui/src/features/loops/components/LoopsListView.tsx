import {
  ArrowRightIcon,
  ClockIcon,
  PlusIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { Box, Flex, Text, TextArea } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useLoops } from "../hooks/useLoops";
import { useLoopDraftStore } from "../loopDraftStore";
import { LOOP_TEMPLATES, type LoopTemplate } from "../loopTemplates";
import { LoopRow } from "./LoopRow";

const EXAMPLE_PROMPTS = [
  "Summarize my open PRs every weekday morning",
  "Triage new issues and flag duplicates",
  "Draft release notes when a PR merges to main",
];

export function LoopsListView() {
  const { data: loops, isLoading, isError, error } = useLoops();
  const [prompt, setPrompt] = useState("");

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <RepeatIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Loops"
        >
          Loops
        </Text>
      </Flex>
    ),
    [],
  );
  useSetHeaderContent(headerContent);

  const allLoops = loops ?? [];

  const startFromPrompt = () => {
    const text = prompt.trim();
    if (!text) return;
    useLoopDraftStore.getState().setPrefill({ instructions: text });
    navigateToNewLoop();
  };

  const startBlank = () => {
    useLoopDraftStore.getState().setPrefill(null);
    navigateToNewLoop();
  };

  const startFromTemplate = (template: LoopTemplate) => {
    useLoopDraftStore.getState().setPrefill(template.build());
    navigateToNewLoop();
  };

  return (
    <Flex direction="column" className="h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-auto">
        <Flex
          direction="column"
          gap="8"
          className="mx-auto max-w-3xl px-6 py-8"
        >
          <Flex align="start" justify="between" gap="3">
            <Flex direction="column" gap="1" className="min-w-0">
              <Text className="font-semibold text-[18px] text-gray-12">
                Loops
              </Text>
              <Text className="text-[12.5px] text-gray-10 leading-snug">
                Automations that run your instructions unattended, on a
                schedule, a GitHub event, or an API call.
              </Text>
            </Flex>
            <Button
              variant="soft"
              color="gray"
              size="2"
              className="shrink-0 gap-1.5"
              onClick={startBlank}
            >
              <PlusIcon size={13} />
              New loop
            </Button>
          </Flex>

          <Flex
            direction="column"
            gap="3"
            className="rounded-(--radius-3) border border-border bg-(--color-panel-solid) p-4"
          >
            <TextArea
              value={prompt}
              placeholder="What do you want automated?"
              className="min-h-[76px] text-[13px] leading-relaxed"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  startFromPrompt();
                }
              }}
            />
            <Flex align="center" justify="between" gap="4">
              <Flex gap="2" wrap="wrap" className="min-w-0 flex-1">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setPrompt(example)}
                    className="rounded-full border border-border bg-(--gray-2) px-3 py-1.5 text-[12px] text-gray-11 leading-none transition-colors hover:border-(--gray-7) hover:text-gray-12"
                  >
                    {example}
                  </button>
                ))}
              </Flex>
              <Button
                variant="solid"
                size="2"
                className="shrink-0 gap-1.5"
                disabled={!prompt.trim()}
                onClick={startFromPrompt}
              >
                Create loop
                <ArrowRightIcon size={13} />
              </Button>
            </Flex>
          </Flex>

          <Section title="Your loops">
            {isLoading ? (
              <LoopsSkeleton />
            ) : isError ? (
              <Notice>
                {error instanceof Error
                  ? error.message
                  : "The loops API returned an error."}
              </Notice>
            ) : allLoops.length === 0 ? (
              <Notice>
                No loops yet. Describe one above, or start from a template
                below.
              </Notice>
            ) : (
              <Flex direction="column" gap="2">
                {allLoops.map((loop) => (
                  <LoopRow key={loop.id} loop={loop} />
                ))}
              </Flex>
            )}
          </Section>

          <Section title="Start from a template">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {LOOP_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={() => startFromTemplate(template)}
                />
              ))}
            </div>
          </Section>
        </Flex>
      </div>
    </Flex>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="3">
      <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
        {title}
      </Text>
      {children}
    </Flex>
  );
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: LoopTemplate;
  onSelect: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-2 rounded-(--radius-3) border border-border bg-(--color-panel-solid) p-4 text-left transition-colors hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex align="center" gap="2">
        <Icon size={16} className="shrink-0 text-gray-11" />
        <Text className="font-medium text-[13px] text-gray-12">
          {template.name}
        </Text>
      </Flex>
      <Text className="text-[12px] text-gray-10 leading-snug">
        {template.description}
      </Text>
      <Flex align="center" gap="1" className="text-gray-10">
        <ClockIcon size={11} className="shrink-0" />
        <Text className="text-[11px]">{template.triggerLabel}</Text>
      </Flex>
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Box className="rounded-(--radius-3) border border-(--gray-5) border-dashed px-4 py-6 text-center text-[12.5px] text-gray-10">
      {children}
    </Box>
  );
}

function LoopsSkeleton() {
  return (
    <Flex direction="column" gap="2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[58px] animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)"
        />
      ))}
    </Flex>
  );
}
