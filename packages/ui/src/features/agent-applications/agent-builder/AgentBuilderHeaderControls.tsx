import { NavigationArrowIcon, SparkleIcon } from "@phosphor-icons/react";
import { agentChatStore } from "@posthog/core/agent-chat/agentChatStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { Button } from "@posthog/ui/primitives/Button";
import { Badge, Flex, Tooltip } from "@radix-ui/themes";
import { useStore } from "zustand";
import { AGENT_PLATFORM_FLAG } from "../featureFlag";
import { headerActionForPage } from "./agentBuilderActions";
import {
  AGENT_BUILDER_CHAT_ID,
  type AgentBuilderPageContext,
  useAgentBuilderStore,
} from "./agentBuilderStore";
import { EditWithAIButton } from "./EditWithAIButton";

/**
 * The agents-header control cluster — identical across every agents view. Driven
 * by the view's `context`, it renders:
 *  - a "Following" indicator while the agent builder is mid-turn and follow mode
 *    is on (so it's clear the builder is steering navigation),
 *  - a contextual AI button (New agent / Explain this session / …),
 *  - a "show" button that opens the dock, ONLY when it's hidden (the inverse of
 *    the hide button inside the dock header).
 * All buttons are small. Renders nothing unless the `agent-platform` flag is on.
 */
export function AgentBuilderHeaderControls({
  context,
}: {
  context: AgentBuilderPageContext;
}) {
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
  const action = headerActionForPage(context);

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
      {action ? (
        <EditWithAIButton
          prompt={action.prompt}
          agentSlug={action.agentSlug}
          label={action.label}
          size="1"
        />
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
