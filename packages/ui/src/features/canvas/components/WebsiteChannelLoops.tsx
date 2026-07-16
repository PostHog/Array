import { PlusIcon, RepeatIcon } from "@phosphor-icons/react";
import { ChannelHeader } from "@posthog/ui/features/canvas/components/ChannelHeader";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToNewLoop } from "@posthog/ui/router/navigationBridge";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { LoopRow } from "../../loops/components/LoopRow";
import { useLoops } from "../../loops/hooks/useLoops";
import { useLoopDraftStore } from "../../loops/loopDraftStore";
import { defaultLoopContextOutputs } from "../../loops/loopFormTypes";
import { useChannels } from "../hooks/useChannels";

/** The "Loops" tab of a context: the automations attached to this context, and a shortcut
 * to create a new one already attached to it. `channelId` is the desktop folder id, which
 * matches a loop's `context_target.folder_id`. */
export function WebsiteChannelLoops({ channelId }: { channelId: string }) {
  const { data: loops, isLoading, isError } = useLoops();
  const { channels } = useChannels();
  const channel = channels.find((c) => c.id === channelId);

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

  const createLoopForContext = () => {
    useLoopDraftStore.getState().setPrefill({
      contextTarget: {
        folderId: channelId,
        name: channel?.name ?? channelId,
        outputs: defaultLoopContextOutputs(),
      },
    });
    navigateToNewLoop();
  };

  return (
    <Flex
      direction="column"
      gap="5"
      className="mx-auto w-full max-w-4xl px-8 py-8"
    >
      <Flex align="center" justify="between" gap="3">
        <Flex direction="column" gap="1" className="min-w-0">
          <Heading className="font-bold text-xl">Loops</Heading>
          <Text color="gray" className="text-sm">
            Automations attached to this context. They can post runs to its feed
            and keep its context.md or a canvas up to date.
          </Text>
        </Flex>
        <Button variant="solid" size="2" onClick={createLoopForContext}>
          <PlusIcon size={14} />
          New loop
        </Button>
      </Flex>

      {isLoading ? (
        <LoopsSkeleton />
      ) : isError ? (
        <EmptyNotice
          title="Couldn't load loops"
          hint="The loops API returned an error. Try again in a moment."
        />
      ) : attachedLoops.length > 0 ? (
        <Flex direction="column" gap="2">
          {attachedLoops.map((loop) => (
            <LoopRow key={loop.id} loop={loop} />
          ))}
        </Flex>
      ) : (
        <EmptyNotice
          icon={<RepeatIcon size={16} />}
          title="No loops attached yet"
          hint="Attach a loop to this context to post its runs here and keep its context.md or a canvas up to date."
        />
      )}
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
      py="7"
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
