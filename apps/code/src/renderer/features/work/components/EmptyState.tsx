import { ClockCounterClockwise, Plus } from "@phosphor-icons/react";
import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { EXAMPLE_PROMPTS } from "../data/examplePrompts";
import type { PendingCreateDraft } from "../stores/workStore";

interface EmptyStateProps {
  onCreate: (initial?: PendingCreateDraft) => void;
}

export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="5"
      className="py-12"
    >
      <Box className="rounded-(--radius-3) border border-(--gray-6) border-dashed p-5">
        <ClockCounterClockwise size={28} className="text-(--gray-8)" />
      </Box>
      <Flex direction="column" align="center" gap="2" className="max-w-md">
        <Text size="3" weight="medium" className="text-(--gray-12)">
          No scheduled tasks yet
        </Text>
        <Text size="2" align="center" className="text-(--gray-11)">
          Set up a task that runs on its own schedule — describe what you want
          done in plain English and pick how often.
        </Text>
      </Flex>

      <Flex direction="column" gap="2" className="w-full max-w-md">
        <Text
          size="1"
          weight="medium"
          className="text-(--gray-10) uppercase tracking-wider"
        >
          Start from an example
        </Text>
        {EXAMPLE_PROMPTS.map((example) => {
          const Icon = example.icon;
          return (
            <button
              key={example.id}
              type="button"
              onClick={() =>
                onCreate({ name: example.name, prompt: example.prompt })
              }
              className="flex w-full cursor-pointer items-start gap-3 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-3 text-left transition-colors hover:bg-(--gray-3)"
            >
              <Box className="mt-[2px] shrink-0 text-(--accent-10)">
                <Icon size={16} weight="duotone" />
              </Box>
              <Flex direction="column" gap="1" className="min-w-0">
                <Text
                  size="2"
                  weight="medium"
                  className="truncate text-(--gray-12)"
                >
                  {example.name}
                </Text>
                <Text size="1" className="text-(--gray-11)">
                  {example.description}
                </Text>
              </Flex>
            </button>
          );
        })}
      </Flex>

      <Button size="2" variant="soft" onClick={() => onCreate()}>
        <Plus size={14} />
        Start from scratch
      </Button>
    </Flex>
  );
}
