import {
  MagnifyingGlassIcon,
  PlusIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { Flex, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useLoops } from "../hooks/useLoops";
import { LoopRow } from "./LoopRow";

export function LoopsListView() {
  const { data: loops, isLoading, isError, error } = useLoops();
  const [query, setQuery] = useState("");

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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allLoops;
    return allLoops.filter(
      (loop) =>
        loop.name.toLowerCase().includes(q) ||
        loop.description.toLowerCase().includes(q),
    );
  }, [allLoops, query]);

  const personalLoops = filtered.filter(
    (loop) => loop.visibility === "personal",
  );
  const teamLoops = filtered.filter((loop) => loop.visibility === "team");

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        align="center"
        justify="between"
        gap="3"
        wrap="wrap"
        className="border-(--gray-5) border-b px-6 py-4"
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <MagnifyingGlassIcon
            size={13}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-gray-10"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search loops…"
            aria-label="Search loops"
            className="h-8 w-full rounded-(--radius-2) border border-border bg-(--color-panel-solid) pr-2 pl-8 text-[12.5px]"
          />
        </div>
        <Button variant="solid" size="1" onClick={navigateToNewLoop}>
          <PlusIcon size={12} />
          New loop
        </Button>
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {isLoading ? (
            <LoopsSkeleton />
          ) : isError ? (
            <Empty className="mx-auto max-w-md py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RepeatIcon size={24} />
                </EmptyMedia>
                <EmptyTitle>Couldn't load loops</EmptyTitle>
                <EmptyDescription>
                  {error instanceof Error
                    ? error.message
                    : "The loops API returned an error."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : allLoops.length === 0 ? (
            <Empty className="mx-auto max-w-md py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RepeatIcon size={24} />
                </EmptyMedia>
                <EmptyTitle>No loops yet</EmptyTitle>
                <EmptyDescription>
                  A loop runs your instructions on a schedule, a GitHub event,
                  or an API call — write the prompt once, pick a trigger, and it
                  runs unattended in the cloud.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Flex direction="column" gap="6">
              <LoopSection
                title="Personal"
                emptyLabel="No personal loops"
                loops={personalLoops}
              />
              <LoopSection
                title="Team"
                emptyLabel="No team loops"
                loops={teamLoops}
              />
            </Flex>
          )}
        </div>
      </div>
    </Flex>
  );
}

function LoopSection({
  title,
  emptyLabel,
  loops,
}: {
  title: string;
  emptyLabel: string;
  loops: LoopSchemas.Loop[];
}) {
  return (
    <Flex direction="column" gap="2">
      <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
        {title}
      </Text>
      {loops.length === 0 ? (
        <Text className="text-[12.5px] text-gray-10">{emptyLabel}</Text>
      ) : (
        <Flex direction="column" gap="2">
          {loops.map((loop) => (
            <LoopRow key={loop.id} loop={loop} />
          ))}
        </Flex>
      )}
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
