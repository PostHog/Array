import { SidebarSimpleIcon, SparkleIcon } from "@phosphor-icons/react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { Flex } from "@radix-ui/themes";
import { AGENT_PLATFORM_FLAG } from "../featureFlag";
import { headerActionForPage } from "./agentBuilderActions";
import { useAgentBuilderStore } from "./agentBuilderStore";

/**
 * The agents-header control cluster — identical across every agents view.
 *
 * One split button is the single entry point into the Agent Builder dock:
 *  - the primary segment is the contextual "edit with AI" action for the view
 *    you're on (New agent / Edit configuration / Explain this session / …) — it
 *    opens the dock and seeds the matching prompt,
 *  - the trailing segment just opens/closes the dock without seeding, so you
 *    can peek at or dismiss the existing conversation.
 * The two were previously near-identical gold buttons; fusing them keeps both
 * affordances but with one sparkle (the AI identity) and one neutral toggle.
 * Views with no obvious action (Scouts) collapse to the lone open/close toggle.
 * Renders nothing unless the `agent-platform` flag is on.
 */
export function AgentBuilderHeaderControls() {
  const enabled = useFeatureFlag(AGENT_PLATFORM_FLAG);
  const visible = useAgentBuilderStore((s) => s.visible);
  const page = useAgentBuilderStore((s) => s.page);
  const toggleVisible = useAgentBuilderStore((s) => s.toggleVisible);
  const startAgentBuilder = useAgentBuilderStore((s) => s.startAgentBuilder);

  if (!enabled) return null;

  const action = headerActionForPage(page);
  const toggleTip = visible
    ? "Hide the agent builder (⌘⇧I)"
    : "Open the agent builder (⌘⇧I)";

  return (
    <TooltipProvider delay={500}>
      <Flex align="center" gap="2" className="shrink-0">
        {action ? (
          <div className="flex items-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-s-[3px] rounded-e-none"
                    onClick={() =>
                      startAgentBuilder(action.prompt, action.agentSlug)
                    }
                  >
                    <SparkleIcon
                      size={14}
                      weight="fill"
                      className="text-(--accent-9)"
                    />
                    {action.label}
                  </Button>
                }
              />
              <TooltipContent side="top">
                Open the agent builder and start here
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="rounded-s-none rounded-e-[3px] border-s-0"
                    aria-label={toggleTip}
                    onClick={toggleVisible}
                  >
                    <SidebarSimpleIcon
                      size={14}
                      weight={visible ? "fill" : "regular"}
                    />
                  </Button>
                }
              />
              <TooltipContent side="top">{toggleTip}</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={toggleTip}
                  onClick={toggleVisible}
                >
                  <SparkleIcon
                    size={14}
                    weight="fill"
                    className="text-(--accent-9)"
                  />
                </Button>
              }
            />
            <TooltipContent side="top">{toggleTip}</TooltipContent>
          </Tooltip>
        )}
      </Flex>
    </TooltipProvider>
  );
}
