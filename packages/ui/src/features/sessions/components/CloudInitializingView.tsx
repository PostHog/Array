import { Brain, Spinner } from "@phosphor-icons/react";
import type { TaskRunStatus } from "@posthog/shared/domain-types";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import zenHedgehog from "../../../assets/images/zen.png";

interface CloudInitializingViewProps {
  cloudStatus: TaskRunStatus | null;
  /**
   * True when this initialization is a resume of a previously terminal run
   * (snapshot restore) rather than a brand-new task — changes the copy from
   * "Starting the sandbox…" to "Restoring your sandbox…".
   */
  isResume?: boolean;
}

const REVEAL_DELAY_MS = 2000;

function copyFor(
  cloudStatus: TaskRunStatus | null,
  isResume: boolean,
): { heading: string; subtitle: string } {
  switch (cloudStatus) {
    case "queued":
      return {
        heading: "Waiting in the queue…",
        subtitle: isResume
          ? "Reserving a cloud sandbox to restore your session — this can take a few seconds."
          : "Reserving a cloud sandbox — this can take a few seconds.",
      };
    case "in_progress":
      return isResume
        ? {
            heading: "Restoring your sandbox…",
            subtitle:
              "Resuming from the last snapshot and reconnecting your cloud runner.",
          }
        : {
            heading: "Starting the sandbox…",
            subtitle: "Connecting to your cloud runner.",
          };
    default:
      return isResume
        ? {
            heading: "Restoring your session…",
            subtitle:
              "Resuming from the last snapshot — your messages will pick up right where they left off.",
          }
        : {
            heading: "Getting things ready…",
            subtitle: "Connecting to your cloud runner.",
          };
  }
}

export function CloudInitializingView({
  cloudStatus,
  isResume = false,
}: CloudInitializingViewProps) {
  const { heading, subtitle } = copyFor(cloudStatus, isResume);

  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!revealed) {
    return (
      <Flex
        align="center"
        justify="center"
        className="absolute inset-0 bg-background"
      >
        <Spinner size={32} className="animate-spin text-gray-9" />
      </Flex>
    );
  }

  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="5"
      className="absolute inset-0 bg-background"
    >
      <div className="zen-float">
        <img src={zenHedgehog} alt="" className="block w-[160px]" />
      </div>
      <Flex direction="column" align="center" gap="2">
        <Flex align="center" gap="2">
          <Spinner size={16} className="animate-spin text-gray-9" />
          <Text className="font-medium text-base">{heading}</Text>
        </Flex>
        <Text color="gray" className="text-sm">
          {subtitle}
        </Text>
      </Flex>
    </Flex>
  );
}

/**
 * Compact one-line restore status shown inline at the bottom of the chat
 * thread while a resume-from-snapshot is in flight — keeps the conversation
 * (including the just-sent message) visible instead of hiding it behind the
 * full-screen initializing overlay.
 */
export function CloudInitializingStatusRow({
  cloudStatus,
}: {
  cloudStatus: TaskRunStatus | null;
}) {
  const { heading } = copyFor(cloudStatus, true);
  return (
    <Flex align="center" gap="2" className="pl-3">
      <Brain size={12} className="ph-pulse text-accent-11" />
      <Text className="text-[13px] text-accent-11">{heading}</Text>
    </Flex>
  );
}
