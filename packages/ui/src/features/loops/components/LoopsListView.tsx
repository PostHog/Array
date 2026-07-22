import { CloudIcon, PlusIcon, RepeatIcon } from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import type { UserBasic } from "@posthog/shared/domain-types";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { useLoopLimits, useLoops } from "../hooks/useLoops";
import { useLoopDraftStore } from "../loopDraftStore";
import type { LoopTemplate } from "../loopTemplates";
import { LoopBuilderComposer } from "./LoopBuilderComposer";
import { LoopsEmptyNotice, LoopsSkeleton } from "./LoopFallbacks";
import { LoopRow } from "./LoopRow";
import { LoopsEmptyState } from "./LoopsEmptyState";
import { LoopTemplatesSection } from "./LoopTemplatesSection";

/** Copy shown when the project is at its loop cap. `max` comes from the backend so the number
 * never drifts from the limit the server actually enforces. */
function loopLimitReason(max: number): string {
  return `You've reached the limit of ${max} loops for this project. Delete one to add another.`;
}

const EMPTY_MEMBERS: UserBasic[] = [];

function startBlankLoop(): void {
  useLoopDraftStore.getState().setPrefill(null);
  navigateToNewLoop();
}

function startLoopFromTemplate(template: LoopTemplate): void {
  useLoopDraftStore
    .getState()
    .setPrefill({ description: template.description, ...template.build() });
  navigateToNewLoop();
}

export function LoopsListView() {
  const { data: loops, isLoading, isError, error } = useLoops();
  const limits = useLoopLimits();
  const limitReason =
    limits?.atLimit === true ? loopLimitReason(limits.max) : null;

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
  const teamLoops = allLoops.filter((loop) => loop.visibility === "team");
  const {
    members,
    isLoading: membersLoading,
    isError: membersError,
    isComplete: membersComplete,
  } = useOrgMembers({ enabled: teamLoops.length > 0 });

  return (
    <LoopsListViewPresentation
      loops={allLoops}
      isLoading={isLoading}
      error={isError ? error : null}
      limitReason={limitReason}
      members={members}
      membersLoading={membersLoading}
      membersError={membersError}
      membersComplete={membersComplete}
      onStartBlank={startBlankLoop}
      onStartFromTemplate={startLoopFromTemplate}
    />
  );
}

interface LoopsListViewPresentationProps {
  loops: LoopSchemas.Loop[];
  isLoading?: boolean;
  error?: unknown;
  limitReason?: string | null;
  members?: UserBasic[];
  membersLoading?: boolean;
  membersError?: boolean;
  membersComplete?: boolean;
  onStartBlank: () => void;
  onStartFromTemplate: (template: LoopTemplate) => void;
}

export function LoopsListViewPresentation({
  loops,
  isLoading = false,
  error = null,
  limitReason = null,
  members = EMPTY_MEMBERS,
  membersLoading = false,
  membersError = false,
  membersComplete = true,
  onStartBlank,
  onStartFromTemplate,
}: LoopsListViewPresentationProps) {
  const personalLoops = loops.filter((loop) => loop.visibility === "personal");
  const teamLoops = loops.filter((loop) => loop.visibility === "team");

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
                call, or when something happens on GitHub. You can finally close
                the laptop!
              </Text>
            </Flex>
            <Button
              variant="soft"
              color="gray"
              size="2"
              onClick={onStartBlank}
              disabled={limitReason != null}
              disabledReason={limitReason}
            >
              <PlusIcon size={14} />
              Create manually
            </Button>
          </Flex>

          {isLoading ? (
            <LoopsSkeleton />
          ) : error ? (
            <LoopsEmptyNotice
              title="Couldn't load loops."
              hint={
                error instanceof Error
                  ? error.message
                  : "The loops API returned an error."
              }
            />
          ) : loops.length > 0 ? (
            <Flex direction="column" gap="5">
              {personalLoops.length > 0 ? (
                <LoopListSection title="Personal loops" loops={personalLoops} />
              ) : null}
              {teamLoops.length > 0 ? (
                <LoopListSection
                  title="Team loops"
                  loops={teamLoops}
                  members={members}
                  membersLoading={membersLoading}
                  membersError={membersError}
                  membersComplete={membersComplete}
                />
              ) : null}
            </Flex>
          ) : (
            <LoopsEmptyState />
          )}

          <LoopTemplatesSection onSelect={onStartFromTemplate} />
        </Flex>
      </div>

      <div className="shrink-0">
        <Flex
          direction="column"
          gap="2"
          className="mx-auto w-full max-w-5xl px-8 pb-6"
        >
          <LoopBuilderComposer disabledReason={limitReason} />
        </Flex>
      </div>
    </Flex>
  );
}

function LoopListSection({
  title,
  loops,
  members = EMPTY_MEMBERS,
  membersLoading = false,
  membersError = false,
  membersComplete = true,
}: {
  title: string;
  loops: LoopSchemas.Loop[];
  members?: UserBasic[];
  membersLoading?: boolean;
  membersError?: boolean;
  membersComplete?: boolean;
}) {
  return (
    <Flex direction="column" gap="3">
      <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
        {title}
      </Text>
      <Flex direction="column" gap="2">
        {loops.map((loop) => (
          <LoopRow
            key={loop.id}
            loop={loop}
            creator={members.find((member) => member.id === loop.created_by_id)}
            creatorLoading={membersLoading}
            creatorError={membersError}
            creatorLookupComplete={membersComplete}
          />
        ))}
      </Flex>
    </Flex>
  );
}
