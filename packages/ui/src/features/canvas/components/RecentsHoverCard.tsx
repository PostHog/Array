import { ClockCounterClockwiseIcon, FileTextIcon } from "@phosphor-icons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  PopoverContent,
  Spinner,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useRecentItems } from "@posthog/ui/features/canvas/hooks/useRecentItems";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import {
  navigateToChannelDashboard,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";

export function RecentsHoverCard({
  onClose,
  side = "right",
}: {
  onClose: () => void;
  side?: "bottom" | "right";
}) {
  const { items, isLoading } = useRecentItems();
  return (
    <PopoverContent
      side={side}
      align="start"
      sideOffset={8}
      className="w-[380px] gap-0 overflow-hidden p-0"
    >
      <div className="flex min-h-12 items-center border-border border-b px-3 font-semibold text-sm">
        Recents
      </div>
      <div className="max-h-[480px] overflow-y-auto p-1.5">
        {isLoading && items.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty className="border-0 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClockCounterClockwiseIcon />
              </EmptyMedia>
              <EmptyTitle>No recents yet</EmptyTitle>
              <EmptyDescription>
                Tasks and canvases you engage with will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <SidebarItem
                key={`${item.kind}:${item.id}`}
                depth={0}
                icon={
                  item.kind === "canvas" ? (
                    iconForTemplate(item.templateId, {
                      size: 15,
                      className: "text-violet-9",
                    })
                  ) : (
                    <FileTextIcon size={15} className="text-blue-9" />
                  )
                }
                label={<span>{item.title || "Untitled task"}</span>}
                isActive={false}
                endContent={
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelativeTimeShort(item.engagedAt)}
                  </span>
                }
                onClick={() => {
                  onClose();
                  if (item.kind === "canvas")
                    navigateToChannelDashboard(item.channelId, item.id);
                  else navigateToTaskDetail(item.id);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </PopoverContent>
  );
}
