import {
  ArrowUpIcon,
  ClockIcon,
  LightningIcon,
  PlugsIcon,
  PlusIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
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
          gap="6"
          className="mx-auto w-full max-w-5xl px-8 py-8"
        >
          <Flex align="center" justify="between" gap="3">
            <Flex direction="column" gap="1" className="min-w-0">
              <Heading className="font-bold text-2xl">Loops</Heading>
              <Text color="gray" className="text-sm">
                Put your work on autopilot. Loops run on a schedule, on an API
                call, or when something happens on GitHub.
              </Text>
            </Flex>
            <Button variant="solid" size="2" onClick={startBlank}>
              <PlusIcon size={14} />
              New loop
            </Button>
          </Flex>

          {isLoading ? (
            <LoopsSkeleton />
          ) : isError ? (
            <EmptyNotice
              title="Couldn't load loops."
              hint={
                error instanceof Error
                  ? error.message
                  : "The loops API returned an error."
              }
            />
          ) : allLoops.length > 0 ? (
            <Flex direction="column" gap="3">
              <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
                Your loops
              </Text>
              <Flex direction="column" gap="2">
                {allLoops.map((loop) => (
                  <LoopRow key={loop.id} loop={loop} />
                ))}
              </Flex>
            </Flex>
          ) : (
            <EmptyNotice
              icon={<RepeatIcon size={15} />}
              title="No loops yet"
              hint="Describe what you want automated below, or start from a template."
            />
          )}

          <Flex direction="column" gap="3">
            <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
              Start from a template
            </Text>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LOOP_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={() => startFromTemplate(template)}
                />
              ))}
            </div>
          </Flex>
        </Flex>
      </div>

      <div className="shrink-0">
        <Flex
          direction="column"
          gap="2"
          className="mx-auto w-full max-w-5xl px-8 pb-6"
        >
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
              placeholder="What do you want automated?"
              className="w-full resize-none bg-transparent text-[13px] text-gray-12 leading-relaxed outline-none placeholder:text-gray-9"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  startFromPrompt();
                }
              }}
            />
            <Flex align="center" justify="between" gap="3">
              <Text className="text-[11px] text-gray-9">
                Drafts a loop you can review before it runs
              </Text>
              <IconButton
                variant="solid"
                size="1"
                aria-label="Draft loop"
                disabled={!prompt.trim()}
                onClick={startFromPrompt}
              >
                <ArrowUpIcon size={13} weight="bold" />
              </IconButton>
            </Flex>
          </Flex>
        </Flex>
      </div>
    </Flex>
  );
}

const TONE_CLASSES: Record<LoopTemplate["tone"], string> = {
  blue: "bg-(--blue-a3) text-(--blue-11)",
  red: "bg-(--red-a3) text-(--red-11)",
  purple: "bg-(--purple-a3) text-(--purple-11)",
  teal: "bg-(--teal-a3) text-(--teal-11)",
  amber: "bg-(--amber-a3) text-(--amber-11)",
  green: "bg-(--green-a3) text-(--green-11)",
};

function TemplateCard({
  template,
  onSelect,
}: {
  template: LoopTemplate;
  onSelect: () => void;
}) {
  const Icon = template.icon;
  const TriggerIcon = template.triggerLabel.startsWith("Triggered")
    ? LightningIcon
    : ClockIcon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-2 rounded-(--radius-3) border border-border bg-(--color-panel-solid) p-4 text-left transition-colors hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex align="center" className="gap-2.5">
        <Flex
          align="center"
          justify="center"
          className={`size-7 shrink-0 rounded-(--radius-2) ${TONE_CLASSES[template.tone]}`}
        >
          <Icon size={15} />
        </Flex>
        <Text className="font-medium text-[14px] text-gray-12">
          {template.name}
        </Text>
      </Flex>
      <Text className="text-[12.5px] text-gray-11 leading-snug">
        {template.description}
      </Text>
      <Flex
        align="center"
        justify="between"
        gap="3"
        className="mt-auto w-full text-gray-10"
      >
        <Flex align="center" className="min-w-0 gap-1.5">
          <TriggerIcon size={12} className="shrink-0" />
          <Text className="truncate text-[11.5px]">
            {template.triggerLabel}
          </Text>
        </Flex>
        <Flex align="center" className="shrink-0 gap-1.5">
          <PlugsIcon size={12} className="shrink-0" />
          <Text className="text-[11.5px]">
            Works with {template.worksWith.join(" · ")}
          </Text>
        </Flex>
      </Flex>
    </button>
  );
}

function EmptyNotice({
  icon,
  title,
  hint,
}: {
  icon?: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="1"
      py="6"
      className="rounded border border-gray-6 border-dashed"
    >
      {icon ? (
        <Flex
          align="center"
          justify="center"
          className="mb-1 size-8 rounded-(--radius-2) bg-(--gray-3) text-gray-11"
        >
          {icon}
        </Flex>
      ) : null}
      <Text className="font-medium text-sm">{title}</Text>
      <Text color="gray" className="text-[13px]">
        {hint}
      </Text>
    </Flex>
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
