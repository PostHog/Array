import { PlusIcon, XIcon } from "@phosphor-icons/react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { Flex } from "@radix-ui/themes";
import type { ReactNode } from "react";

export interface TabView {
  id: string;
  label: string;
  /** Optional leading icon (template-derived). */
  icon?: ReactNode;
  /** Channel the tab belongs to; shown `#`-prefixed atop the hover. Null = no
   * channel (a blank tab). */
  channelName?: string | null;
}

export interface TabStripProps {
  tabs: TabView[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
}

/**
 * Presentational title-bar tab strip: pill tabs (active elevated/white,
 * inactive muted) with an optional icon + label and a hover-revealed close,
 * plus a trailing new-tab button. Pure render — all state and resolution is
 * supplied by the container, so it stays storyable.
 */
export function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
}: TabStripProps) {
  return (
    <TooltipProvider delay={400}>
      <Flex
        align="center"
        gap="1"
        className="no-drag h-6 min-w-0 flex-1 pt-px pr-2"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const pill = (
            <div
              key={tab.id}
              className="group relative flex min-w-0 max-w-[200px] flex-1 basis-[200px] items-center overflow-hidden"
            >
              <Button
                variant="default"
                size="sm"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(tab.id)}
                className={`h-6 w-full justify-start gap-1 px-2 transition-[padding] group-hover:pr-6 ${
                  isActive ? "bg-background" : "opacity-60 hover:opacity-100"
                }`}
              >
                {tab.icon ? (
                  <span className="flex shrink-0 items-center [&>svg]:size-3.5">
                    {tab.icon}
                  </span>
                ) : null}
                {/* Fade the right edge instead of an ellipsis; the label shrinks
                    on hover (button gets pr) so the fade follows, clearing room
                    for the close button. */}
                <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left [-webkit-mask-image:linear-gradient(to_right,#000,#000_calc(100%-0.75rem),#0000)] [mask-image:linear-gradient(to_right,#000,#000_calc(100%-0.75rem),#0000)]">
                  {tab.label}
                </span>
              </Button>
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="-translate-y-1/2 absolute top-1/2 right-1 flex size-4 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
              >
                <XIcon size={12} />
              </button>
            </div>
          );

          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger render={pill} />
              <TooltipContent side="bottom">
                {/* Channel context first (always `#`-prefixed), then the page
                    name. The channel-home tab's label IS the channel name, so
                    drop the duplicate second line there. */}
                {tab.channelName ? (
                  <div className="text-muted">#{tab.channelName}</div>
                ) : null}
                {tab.label !== tab.channelName ? (
                  <div className="font-medium">{tab.label}</div>
                ) : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                aria-label="New tab"
                className="shrink-0"
                onClick={onNewTab}
              >
                <PlusIcon size={14} />
              </Button>
            }
          />
          <TooltipContent side="bottom">New tab</TooltipContent>
        </Tooltip>
      </Flex>
    </TooltipProvider>
  );
}
