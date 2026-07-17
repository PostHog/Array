import { PlusIcon } from "@phosphor-icons/react";
import { ChannelHeader } from "@posthog/ui/features/canvas/components/ChannelHeader";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { LoopBuilderComposer } from "../../loops/components/LoopBuilderComposer";
import { LoopRow } from "../../loops/components/LoopRow";
import { LoopsEmptyState } from "../../loops/components/LoopsEmptyState";
import { LoopTemplatesSection } from "../../loops/components/LoopTemplatesSection";
import { useLoops } from "../../loops/hooks/useLoops";
import { useLoopDraftStore } from "../../loops/loopDraftStore";
import { defaultLoopContextOutputs } from "../../loops/loopFormTypes";
import type { LoopTemplate } from "../../loops/loopTemplates";
import { useChannels } from "../hooks/useChannels";

/** The "Loops" tab of a context: the same build experience as the main Loops page (agent
 * composer, templates, manual), but every path attaches the new loop to this context.
 * `channelId` is the desktop folder id, which matches a loop's `context_target.folder_id`. */
export function WebsiteChannelLoops({ channelId }: { channelId: string }) {
  const { data: loops, isLoading, isError } = useLoops();
  const { channels } = useChannels();
  const channel = channels.find((c) => c.id === channelId);
  const contextName = channel?.name ?? channelId;

  useSetHeaderContent(
    useMemo(() => <ChannelHeader channelId={channelId} />, [channelId]),
  );

  const attachedLoops = useMemo(
    () =>
      (loops ?? []).filter(
        (loop) => loop.context_target?.folder_id === channelId,
      ),
    [loops, channelId],
  );

  const contextTarget = useMemo(
    () => ({
      folderId: channelId,
      name: contextName,
      outputs: defaultLoopContextOutputs(),
    }),
    [channelId, contextName],
  );

  const startBlank = () => {
    useLoopDraftStore.getState().setPrefill({ contextTarget });
    navigateToNewLoop();
  };

  const startFromTemplate = (template: LoopTemplate) => {
    useLoopDraftStore
      .getState()
      .setPrefill({ ...template.build(), contextTarget });
    navigateToNewLoop();
  };

  return (
    <Flex
      direction="column"
      gap="6"
      className="mx-auto w-full max-w-4xl px-8 py-8"
    >
      <Flex align="center" justify="between" gap="3">
        <Flex direction="column" gap="1" className="min-w-0">
          <Heading className="font-bold text-xl">Loops</Heading>
          <Text color="gray" className="text-sm">
            Automations attached to this context. They post their runs to its
            feed and can keep its context.md or a canvas up to date.
          </Text>
        </Flex>
        <Button variant="solid" size="2" onClick={startBlank}>
          <PlusIcon size={14} />
          Create manually
        </Button>
      </Flex>

      <LoopBuilderComposer
        context={{ folderId: channelId, name: contextName }}
      />

      {isLoading ? (
        <LoopsSkeleton />
      ) : isError ? (
        <EmptyNotice
          title="Couldn't load loops"
          hint="The loops API returned an error. Try again in a moment."
        />
      ) : attachedLoops.length > 0 ? (
        <Flex direction="column" gap="3">
          <Text className="font-medium text-[12px] text-gray-10 uppercase tracking-wide">
            Attached loops
          </Text>
          <Flex direction="column" gap="2">
            {attachedLoops.map((loop) => (
              <LoopRow key={loop.id} loop={loop} />
            ))}
          </Flex>
        </Flex>
      ) : (
        <LoopsEmptyState contextName={contextName} />
      )}

      <LoopTemplatesSection onSelect={startFromTemplate} />
    </Flex>
  );
}

function EmptyNotice({ title, hint }: { title: string; hint: string }) {
  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="1"
      py="7"
      className="rounded border border-gray-6 border-dashed"
    >
      <Text className="font-medium text-sm">{title}</Text>
      <Text color="gray" className="max-w-[420px] text-center text-[13px]">
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
          className="h-[68px] animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)"
        />
      ))}
    </Flex>
  );
}
