import {
  ArrowSquareOutIcon,
  ArrowUpIcon,
  ClockIcon,
  CloudIcon,
  LightningIcon,
  PlugsIcon,
  PlusIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import { loopHog } from "@posthog/ui/assets/hedgehogs";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useLoopBuilderTask } from "../hooks/useLoopBuilderTask";
import { useLoops } from "../hooks/useLoops";
import { useLoopDraftStore } from "../loopDraftStore";
import {
  LOOP_TEMPLATE_CATEGORIES,
  LOOP_TEMPLATES,
  type LoopTemplate,
  type LoopTemplateCategory,
} from "../loopTemplates";
import { LoopRow } from "./LoopRow";

// Placeholder until the loops docs page lands; swap for the final URL.
const LOOPS_DOCS_URL = "https://posthog.com/docs/loops";

const EXAMPLE_PROMPTS = [
  "Summarize my open PRs every weekday morning",
  "Triage new issues and flag duplicates",
  "Draft release notes when a PR merges to main",
];

export function LoopsListView() {
  const { data: loops, isLoading, isError, error } = useLoops();
  const [prompt, setPrompt] = useState("");
  const [templateCategory, setTemplateCategory] =
    useState<LoopTemplateCategory>("engineering");
  const { runTask: runLoopBuilder, isRunning: isBuildingLoop } =
    useLoopBuilderTask();

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
    if (!text || isBuildingLoop) return;
    void runLoopBuilder(text);
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
              <Flex align="center" gap="2">
                <Heading className="font-bold text-2xl">Loops</Heading>
                <Flex
                  align="center"
                  className="gap-1.5 rounded-full bg-(--accent-a3) px-2.5 py-1"
                >
                  <CloudIcon
                    size={12}
                    weight="fill"
                    className="text-(--accent-11)"
                  />
                  <Text className="font-medium text-(--accent-11) text-[11px]">
                    Runs entirely in the cloud
                  </Text>
                </Flex>
              </Flex>
              <Text color="gray" className="max-w-2xl text-sm">
                Put your work on autopilot. Loops run on a schedule, on an API
                call, or when something happens on GitHub. You can finally
                close the laptop!
              </Text>
            </Flex>
            <Button variant="solid" size="2" onClick={startBlank}>
              <PlusIcon size={14} />
              Create manually
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
            <LoopsEmptyState />
          )}

          <Flex direction="column" gap="3">
            <Flex align="center" justify="between" gap="3">
              <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
                Start from a template
              </Text>
              <Flex className="gap-0.5 rounded-full border border-gray-5 bg-gray-2 p-0.5">
                {LOOP_TEMPLATE_CATEGORIES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTemplateCategory(option.value)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      templateCategory === option.value
                        ? "bg-(--gray-4) text-gray-12"
                        : "text-gray-10 hover:text-gray-12"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </Flex>
            </Flex>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LOOP_TEMPLATES.filter(
                (template) => template.category === templateCategory,
              ).map((template) => (
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
              disabled={isBuildingLoop}
              placeholder="What do you want automated?"
              className="w-full resize-none bg-transparent text-[13px] text-gray-12 leading-relaxed outline-none placeholder:text-gray-9 disabled:opacity-60"
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
                An agent builds the loop with you, then creates it on your
                confirmation
              </Text>
              <IconButton
                variant="solid"
                size="1"
                aria-label="Build loop with an agent"
                loading={isBuildingLoop}
                disabled={!prompt.trim() || isBuildingLoop}
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
      className="flex items-start gap-2.5 rounded-(--radius-3) border border-border bg-(--color-panel-solid) p-3 text-left transition-colors hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex
        align="center"
        justify="center"
        className={`size-6 shrink-0 rounded-(--radius-2) ${TONE_CLASSES[template.tone]}`}
      >
        <Icon size={13} />
      </Flex>
      <Flex direction="column" gap="1" className="min-w-0 flex-1">
        <Text className="font-medium text-[13px] text-gray-12 leading-tight">
          {template.name}
        </Text>
        <Text className="text-[12px] text-gray-11 leading-snug">
          {template.description}
        </Text>
        <Flex
          align="center"
          justify="between"
          gap="3"
          className="mt-0.5 w-full text-(--accent-11)"
        >
          <Flex align="center" className="min-w-0 gap-1.5">
            <TriggerIcon size={11} className="shrink-0" />
            <Text className="truncate text-[11px]">
              {template.triggerLabel}
            </Text>
          </Flex>
          <Flex align="center" className="shrink-0 gap-1.5">
            <PlugsIcon size={11} className="shrink-0" />
            <Text className="text-[11px]">
              Works with {template.worksWith.join(" · ")}
            </Text>
          </Flex>
        </Flex>
      </Flex>
    </button>
  );
}

const GETTING_STARTED_STEPS = [
  "Describe what you want, or start from a template",
  "Pick when it runs and what it can touch",
  "Review it once, then it runs unattended in the cloud and reports back",
];

function LoopsEmptyState() {
  return (
    <Flex
      align="center"
      className="rounded-(--radius-3) border border-gray-6 border-dashed px-8 py-8"
    >
      <Flex justify="center" className="w-2/5 shrink-0">
        <img src={loopHog} alt="" className="h-auto w-52 object-contain" />
      </Flex>
      <Flex direction="column" align="start" gap="4" className="min-w-0 flex-1">
        <Flex direction="column" gap="1">
          <Text className="font-semibold text-[16px] text-gray-12">
            Create your first loop
          </Text>
          <Text className="text-[13px] text-gray-11 leading-relaxed">
            Set it up once and it keeps running on its own, even with your
            laptop closed.
          </Text>
        </Flex>
        <div className="flex flex-col gap-2">
          {GETTING_STARTED_STEPS.map((step, index) => (
            <div key={step} className="flex items-center gap-2.5">
              <Flex
                align="center"
                justify="center"
                className="size-5 shrink-0 rounded-full border border-(--gray-7) font-medium text-[11px] text-gray-11"
              >
                {index + 1}
              </Flex>
              <Text className="text-[13px] text-gray-11">{step}</Text>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          color="gray"
          size="2"
          onClick={() => void openUrlInBrowser(LOOPS_DOCS_URL)}
        >
          Learn more
          <ArrowSquareOutIcon size={14} />
        </Button>
      </Flex>
    </Flex>
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
