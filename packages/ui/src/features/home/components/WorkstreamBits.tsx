import {
  Archive,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  DotsThree,
  GitPullRequest,
  Sparkle,
  XCircle,
} from "@phosphor-icons/react";
import type { PrCiStatus } from "@posthog/core/home/prSnapshot";
import type { SituationId } from "@posthog/core/workflow/schemas";
import { Button } from "@posthog/quill";
import type { BoundAction } from "@posthog/ui/features/home/hooks/useBoundActions";
import {
  SITUATION_VISUAL,
  situationCss,
} from "@posthog/ui/features/home/utils/situationDisplay";
import { DropdownMenu, Text } from "@radix-ui/themes";
import { Fragment } from "react";

/** The tinted square status tile that leads every row / card, glyphed by primary situation. */
export function StatusGlyph({
  sid,
  size = 30,
}: {
  sid: SituationId;
  size?: number;
}) {
  const v = SITUATION_VISUAL[sid];
  const c = situationCss(v.color);
  const Icon = v.Icon;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[7px]"
      style={{
        width: size,
        height: size,
        backgroundColor: c.tint,
        color: c.fg,
      }}
      title={`${v.label} – ${v.description}`}
    >
      <Icon size={Math.round(size * 0.52)} weight="bold" />
    </span>
  );
}

export function StatusDot({ sid }: { sid: SituationId }) {
  const c = situationCss(SITUATION_VISUAL[sid].color);
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: c.solid }}
    />
  );
}

/** Compact CI signal – icon-only by default, optional inline label. */
export function CiIndicator({
  status,
  showLabel = false,
}: {
  status: PrCiStatus;
  showLabel?: boolean;
}) {
  if (status === "none") return null;
  if (status === "passing") {
    return (
      <span
        className="inline-flex items-center gap-1 text-(--green-11)"
        title="CI passing"
      >
        <CheckCircle size={13} weight="fill" />
        {showLabel ? <span className="text-[11px]">CI passing</span> : null}
      </span>
    );
  }
  if (status === "failing") {
    return (
      <span
        className="inline-flex items-center gap-1 text-(--red-11)"
        title="CI failing"
      >
        <XCircle size={13} weight="fill" />
        {showLabel ? <span className="text-[11px]">CI failing</span> : null}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-(--amber-11)"
      title="CI running"
    >
      <CircleNotch size={13} weight="bold" className="animate-spin" />
      {showLabel ? <span className="text-[11px]">CI running</span> : null}
    </span>
  );
}

/**
 * GitHub avatar for a PR author. Same `github.com/<login>.png` source +
 * `.github-avatar` placeholder as the inbox; hides itself if it can't load.
 */
export function AuthorAvatar({
  login,
  size = 18,
}: {
  login: string | null;
  size?: number;
}) {
  if (!login) return null;
  return (
    <img
      src={`https://github.com/${login}.png?size=${size * 2}`}
      alt={`@${login}`}
      title={`@${login}`}
      className="github-avatar shrink-0 rounded-full"
      style={{ width: size, height: size }}
      onLoad={(e) => e.currentTarget.classList.add("loaded")}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

/**
 * The "more actions" overflow shared by the row and card: non-primary bound
 * actions, then the open-PR / open-task fallbacks.
 */
export function WorkstreamOverflowMenu({
  restBound,
  showPrInMenu,
  showTaskInMenu,
  showArchive = false,
  onRun,
  onOpenPr,
  onOpenTask,
  onArchive,
  size = "sm",
  runDisabled = false,
}: {
  restBound: BoundAction[];
  showPrInMenu: boolean;
  showTaskInMenu: boolean;
  /** Whether to offer "Archive" in the menu. */
  showArchive?: boolean;
  onRun: (action: BoundAction) => void;
  onOpenPr: () => void;
  onOpenTask: () => void;
  onArchive?: () => void;
  size?: "sm" | "xs";
  /** Disables the task-starting actions while one is already in flight. */
  runDisabled?: boolean;
}) {
  const sparkleSize = size === "xs" ? 11 : 12;
  const dotsSize = size === "xs" ? 15 : 16;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant="link-muted" size={size} title="More actions">
          <DotsThree size={dotsSize} weight="bold" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {restBound.map((action) => (
          <DropdownMenu.Item
            key={`${action.situationId}::${action.id}`}
            disabled={runDisabled}
            onSelect={() => onRun(action)}
          >
            <Sparkle size={sparkleSize} />
            {action.label}
            <Text className="ml-auto pl-3 text-(--gray-10) text-[10px]">
              {action.situationLabel}
            </Text>
          </DropdownMenu.Item>
        ))}
        {restBound.length > 0 && (showPrInMenu || showTaskInMenu) ? (
          <DropdownMenu.Separator />
        ) : null}
        {showPrInMenu ? (
          <DropdownMenu.Item onSelect={onOpenPr}>
            <GitPullRequest size={12} />
            Open PR in browser
            <ArrowSquareOut size={10} className="ml-auto pl-3" />
          </DropdownMenu.Item>
        ) : null}
        {showTaskInMenu ? (
          <DropdownMenu.Item onSelect={onOpenTask}>Open task</DropdownMenu.Item>
        ) : null}
        {showArchive && onArchive ? (
          <>
            {restBound.length > 0 || showPrInMenu || showTaskInMenu ? (
              <DropdownMenu.Separator />
            ) : null}
            <DropdownMenu.Item onSelect={onArchive}>
              <Archive size={12} />
              Archive
            </DropdownMenu.Item>
          </>
        ) : null}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

export interface MetaItem {
  key: string;
  node: React.ReactNode;
}

/**
 * A muted, dot-separated metadata line (repo · branch · #PR · …). Callers pass
 * only the items that exist, so separators never dangle.
 */
export function MetaList({
  items,
  className,
}: {
  items: MetaItem[];
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-(--gray-10) text-[11px] ${className ?? ""}`}
    >
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 ? (
            <span aria-hidden className="text-(--gray-6)">
              ·
            </span>
          ) : null}
          {item.node}
        </Fragment>
      ))}
    </div>
  );
}
