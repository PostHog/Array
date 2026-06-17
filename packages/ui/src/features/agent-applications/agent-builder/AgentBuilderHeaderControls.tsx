import { NavigationArrowIcon, SparkleIcon } from "@phosphor-icons/react";
import { agentChatStore } from "@posthog/core/agent-chat/agentChatStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { Button } from "@posthog/ui/primitives/Button";
import { Badge, Flex, Tooltip } from "@radix-ui/themes";
import { useStore } from "zustand";
import { AGENT_PLATFORM_FLAG } from "../featureFlag";
import {
  AGENT_BUILDER_CHAT_ID,
  useAgentBuilderStore,
} from "./agentBuilderStore";

/**
 * The agents-header control cluster — identical across every agents view.
 * Authoring lives entirely inside the dock (there is no native "new agent"
 * form), so the only header affordance is the dock toggle itself, plus a
 * "Following" indicator while the builder is mid-turn with follow mode on.
 * Renders nothing unless the `agent-platform` flag is on.
 */
export function AgentBuilderHeaderControls() {
  const enabled = useFeatureFlag(AGENT_PLATFORM_FLAG);
  const visible = useAgentBuilderStore((s) => s.visible);
  const setVisible = useAgentBuilderStore((s) => s.setVisible);
  const followMode = useAgentBuilderStore((s) => s.followMode);
  const status = useStore(
    agentChatStore,
    (s) => s.chats[AGENT_BUILDER_CHAT_ID]?.status,
  );

  if (!enabled) return null;

  const running = status === "streaming" || status === "starting";

  return (
    <Flex align="center" gap="2" className="shrink-0">
      {running && followMode ? (
        <Tooltip content="The agent builder is navigating this view">
          <Badge color="purple" variant="soft" size="1">
            <NavigationArrowIcon size={11} weight="fill" />
            Following
          </Badge>
        </Tooltip>
      ) : null}
      {!visible ? (
        <Tooltip content="Open the agent builder (⌘⇧I)">
          <Button
            variant="outline"
            size="1"
            onClick={() => setVisible(true)}
            aria-label="Open agent builder"
          >
            <SparkleIcon size={14} weight="fill" />
          </Button>
        </Tooltip>
      ) : null}
    </Flex>
  );
}
