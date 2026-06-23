import { HashIcon } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@posthog/quill";
import { HeaderTitleEditor } from "@posthog/ui/features/task-detail/HeaderTitleEditor";
import { Flex, Text } from "@radix-ui/themes";
import { type ReactNode, useState } from "react";

interface ChannelBreadcrumbProps {
  /** The channel (root) segment label. */
  channelName: string;
  /** Optional leading icon for the leaf segment (e.g. a canvas's tier icon). */
  leafIcon?: ReactNode;
  /** The trailing (current page) segment label. */
  leafLabel: string;
  /**
   * When provided, the leaf becomes inline-editable: double-click to rename,
   * Enter or blur to submit, Escape to cancel. Receives the trimmed new value.
   */
  onRename?: (next: string) => void;
  /** Right-aligned slot pushed to the far end of the bar (e.g. an opener). */
  trailing?: ReactNode;
}

// "# channel / leaf" header breadcrumb shared across channel scenes (CONTEXT.md,
// new + existing tasks, canvases). The leaf can carry a tier icon and, when
// onRename is given, edits inline using the same editor as task titles.
export function ChannelBreadcrumb({
  channelName,
  leafIcon,
  leafLabel,
  onRename,
  trailing,
}: ChannelBreadcrumbProps) {
  const [editing, setEditing] = useState(false);

  return (
    <Flex align="center" justify="between" gap="2" className="w-full min-w-0">
      <Flex align="center" gap="2" className="min-w-0">
        <div className="flex items-center gap-1">
          <HashIcon
            size={12}
            className="mt-px shrink-0 text-muted-foreground/80"
          />
          <Text
            className="min-w-0 truncate whitespace-nowrap font-medium text-[13px]"
            title={channelName}
          >
            {channelName}
          </Text>
        </div>
        <Text className="shrink-0 text-[13px] text-muted-foreground/20">/</Text>
        <div className="flex items-center gap-1.5">
          {leafIcon && (
            <span className="mt-px flex shrink-0 text-primary">{leafIcon}</span>
          )}
          {editing && onRename ? (
            <HeaderTitleEditor
              initialTitle={leafLabel}
              onSubmit={(next) => {
                setEditing(false);
                onRename(next);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Text
                    truncate
                    className="no-drag min-w-0 whitespace-nowrap text-[13px]"
                    onDoubleClick={
                      onRename ? () => setEditing(true) : undefined
                    }
                  />
                }
              >
                {leafLabel}
              </TooltipTrigger>
              <TooltipContent>{leafLabel}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </Flex>
      {trailing}
    </Flex>
  );
}
