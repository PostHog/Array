import type { IconProps } from "@phosphor-icons/react";
import {
  BrainIcon,
  BugIcon,
  CompassIcon,
  GithubLogoIcon,
  KanbanIcon,
  LifebuoyIcon,
  TicketIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import { PgAnalyzeIcon } from "@posthog/ui/features/inbox/components/utils/PgAnalyzeIcon";
import type { SourceProduct } from "@posthog/ui/features/inbox/stores/inboxSignalsFilterStore";
import type { ComponentType } from "react";

interface SourceProductMeta {
  Icon: ComponentType<IconProps>;
  color: string;
  label: string;
}

/**
 * Shared source product metadata used across inbox components. Keyed on
 * `SourceProduct` so typo'd lookups (e.g. `signal_scout`) fail to compile
 * rather than silently returning undefined at runtime.
 *
 * `Partial` because the backend may ship a new source product before the
 * renderer learns about it – callers must handle the `undefined` case.
 */
/**
 * Lookup helper that accepts the loosely-typed `source_products` strings
 * coming from the backend and returns metadata only when we recognize the
 * key. Use this instead of `SOURCE_PRODUCT_META[someString]` so an unknown
 * source product surfaces as `null` rather than a runtime error.
 */
export function getSourceProductMeta(
  value: string | null | undefined,
): SourceProductMeta | null {
  if (!value) return null;
  return SOURCE_PRODUCT_META[value as SourceProduct] ?? null;
}

/** True if at least one source product in `values` has known display metadata. */
export function hasKnownSourceProduct(
  values: string[] | null | undefined,
): boolean {
  return (values ?? []).some((value) => getSourceProductMeta(value) !== null);
}

export const SOURCE_PRODUCT_META: Partial<
  Record<SourceProduct, SourceProductMeta>
> = {
  session_replay: {
    Icon: VideoIcon,
    color: "var(--amber-9)",
    label: "Session replay",
  },
  error_tracking: {
    Icon: BugIcon,
    color: "var(--red-9)",
    label: "Error tracking",
  },
  llm_analytics: {
    Icon: BrainIcon,
    color: "var(--purple-9)",
    label: "AI observability",
  },
  github: {
    Icon: GithubLogoIcon,
    color: "var(--gray-11)",
    label: "GitHub",
  },
  linear: {
    Icon: KanbanIcon,
    color: "var(--blue-9)",
    label: "Linear",
  },
  zendesk: {
    Icon: TicketIcon,
    color: "var(--green-9)",
    label: "Zendesk",
  },
  conversations: {
    Icon: LifebuoyIcon,
    color: "var(--cyan-9)",
    label: "Conversations",
  },
  pganalyze: {
    Icon: PgAnalyzeIcon,
    color: "var(--gray-12)",
    label: "pganalyze",
  },
  signals_scout: {
    Icon: CompassIcon,
    color: "var(--iris-9)",
    label: "Scout",
  },
};
