import { Badge, Button } from "@posthog/quill";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { openInPostHog } from "./openInPostHog";

export type EmbedBadgeVariant =
  | "default"
  | "success"
  | "info"
  | "warning"
  | "destructive";

/**
 * Presentational card shell shared by all notebook entity embeds: an icon +
 * title header with an optional status badge and "open in PostHog" button,
 * followed by optional body rows.
 */
export function EmbedCard({
  icon,
  title,
  badge,
  badgeVariant = "default",
  url,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  badge?: string | null;
  badgeVariant?: EmbedBadgeVariant;
  /** Cloud web-app URL; renders the external-link button when set. */
  url?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-(--gray-4) p-3">
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center text-(--gray-9) [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium text-(--gray-12) text-sm">
          {title}
        </span>
        {badge ? <Badge variant={badgeVariant}>{badge}</Badge> : null}
        {url ? (
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Open in PostHog"
            onClick={() => openInPostHog(url)}
          >
            <ExternalLink />
          </Button>
        ) : null}
      </div>
      {children ? (
        <div className="mt-2 flex flex-col gap-1">{children}</div>
      ) : null}
    </div>
  );
}

/** A labelled body row inside an EmbedCard. */
export function EmbedCardRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-24 shrink-0 text-(--gray-9)">{label}</span>
      <span className="min-w-0 flex-1 break-words text-(--gray-11)">
        {children}
      </span>
    </div>
  );
}

/** Muted single-line hint inside an EmbedCard body (e.g. "not configured"). */
export function EmbedCardHint({ children }: { children: ReactNode }) {
  return <div className="text-(--gray-9) text-xs">{children}</div>;
}

export function EmbedCardSkeleton() {
  return (
    <div className="rounded-md border border-(--gray-4) p-3">
      <div className="h-4 w-1/3 animate-pulse rounded bg-(--gray-4)" />
      <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-(--gray-3)" />
    </div>
  );
}

export function EmbedCardError({
  title,
  error,
}: {
  title: string;
  error: unknown;
}) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div className="rounded-md border border-(--gray-4) p-3">
      <div className="font-medium text-(--gray-11) text-sm">{title}</div>
      <div className="mt-1 break-words text-(--red-11) text-xs">
        Failed to load: {message}
      </div>
    </div>
  );
}
