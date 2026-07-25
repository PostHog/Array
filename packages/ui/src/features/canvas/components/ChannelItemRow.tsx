import { PreviewCard } from "@base-ui/react/preview-card";
import { Archive, PushPin } from "@phosphor-icons/react";
import { Avatar, AvatarFallback, Badge } from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { NestedButton } from "@posthog/ui/primitives/NestedButton";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import type { ReactNode } from "react";

type StatusVariant = "default" | "destructive" | "info" | "success" | "warning";

export interface ChannelItem {
  key: string;
  kind: "task" | "canvas";
  title: string;
  ts: number;
  pinned: boolean;
  icon: ReactNode;
  isActive: boolean;
  /** Run status ("In progress", …) for the hover card; tasks only. */
  status: string | null;
  /** Raw run status value, for the status filter. */
  rawStatus: string | null;
  statusVariant: StatusVariant;
  /** Who created it — the full user when known (tasks), else a name. */
  authorUser: UserBasic | null;
  authorName: string | null;
  onClick: () => void;
  onTogglePin: () => void;
  /** Tasks only — canvases can't be archived. */
  onArchive?: () => void;
}

export function humanizeStatus(
  status: string | null | undefined,
): string | null {
  if (!status) return null;
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusVariantFor(
  status: string | null | undefined,
): StatusVariant {
  if (!status) return "default";
  const value = status.toLowerCase();
  if (value.includes("complete")) return "success";
  if (value.includes("fail") || value.includes("error")) return "destructive";
  if (
    value.includes("progress") ||
    value.includes("running") ||
    value.includes("pending") ||
    value.includes("start")
  ) {
    return "info";
  }
  return "default";
}

const HOVER_ACTION_CLASS =
  "flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground";

export function ChannelItemRow({ item }: { item: ChannelItem }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={400}
        closeDelay={100}
        render={
          <div className="min-w-0">
            <SidebarItem
              depth={0}
              icon={item.icon}
              // A non-string label opts out of SidebarItem's truncation tooltip.
              label={<span>{item.title}</span>}
              isActive={item.isActive}
              onClick={item.onClick}
              endContent={
                <>
                  <span className="shrink-0 text-[11px] text-muted-foreground group-hover:hidden">
                    {formatRelativeTimeShort(item.ts)}
                  </span>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <Tooltip content={item.pinned ? "Unpin" : "Pin"} side="top">
                      <NestedButton
                        aria-label={item.pinned ? "Unpin" : "Pin"}
                        className={HOVER_ACTION_CLASS}
                        onActivate={item.onTogglePin}
                      >
                        <PushPin
                          size={12}
                          weight={item.pinned ? "fill" : "regular"}
                        />
                      </NestedButton>
                    </Tooltip>
                    {item.onArchive && (
                      <Tooltip content="Archive task" side="top">
                        <NestedButton
                          aria-label="Archive task"
                          className={HOVER_ACTION_CLASS}
                          onActivate={item.onArchive}
                        >
                          <Archive size={12} />
                        </NestedButton>
                      </Tooltip>
                    )}
                  </span>
                </>
              }
            />
          </div>
        }
      />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="start"
          sideOffset={10}
          className="z-50"
        >
          <PreviewCard.Popup className="w-64 rounded-lg border border-border bg-background p-3 shadow-lg outline-none">
            <div className="flex items-start gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-[13px] text-foreground leading-snug">
                  {item.title}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.kind === "canvas" ? "Canvas" : "Task"} · updated{" "}
                  {formatRelativeTimeShort(item.ts)}
                </p>
              </div>
            </div>
            {item.status && (
              <div className="mt-2">
                <Badge variant={item.statusVariant}>{item.status}</Badge>
              </div>
            )}
            {(item.authorUser || item.authorName) && (
              <div className="mt-2.5 flex items-center gap-2 border-border border-t pt-2.5">
                {item.authorUser ? (
                  <UserAvatar user={item.authorUser} />
                ) : (
                  <Avatar>
                    <AvatarFallback>
                      {(item.authorName ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-foreground">
                    {item.authorName ?? "Unknown"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Created by
                  </p>
                </div>
              </div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
