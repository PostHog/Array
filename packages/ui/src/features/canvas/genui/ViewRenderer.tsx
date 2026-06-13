import type { Spec } from "@json-render/react";
import { useIsVisible } from "@json-render/react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  type ElementOn,
  PLAIN_CTX,
  renderBody,
} from "@posthog/ui/features/canvas/genui/bodies";
import {
  CanvasProviders,
  useResolvedProps,
} from "@posthog/ui/features/canvas/genui/CanvasProviders";
import { useRefreshDashboard } from "@posthog/ui/features/canvas/hooks/useRefreshDashboard";
import { Box, IconButton } from "@radix-ui/themes";
import type { ReactNode } from "react";

// Stable empty-props reference so the resolve hook runs unconditionally (even
// for a missing element) without churning on every render.
const EMPTY_PROPS: Record<string, unknown> = {};

// Read-only renderer for a saved canvas. Mirrors the shared bodies (so it's
// pixel-identical to edit mode) but is a key-aware walk so each Card can carry a
// hover "refresh this card" button — createRenderer doesn't expose element keys.
// The walk is wrapped in CanvasProviders so the declarative dynamic features
// (state, {$state}/{$bindState} bindings, `visible`, `on`/actions) resolve.
export function ViewRenderer({
  spec,
  dashboardId,
}: {
  spec: Spec;
  dashboardId: string;
}) {
  const { refresh, isRefreshing } = useRefreshDashboard(dashboardId);
  return (
    <CanvasProviders spec={spec}>
      <ViewNode
        spec={spec}
        elementKey={spec.root}
        onRefreshCard={(cardKey) => refresh({ elementKeys: [cardKey] })}
        isRefreshing={isRefreshing}
      />
    </CanvasProviders>
  );
}

function ViewNode({
  spec,
  elementKey,
  onRefreshCard,
  isRefreshing,
}: {
  spec: Spec;
  elementKey: string;
  onRefreshCard: (cardKey: string) => void;
  isRefreshing: boolean;
}) {
  const element = spec.elements[elementKey];
  // Hooks must run unconditionally and in stable order, so call them before any
  // early return (a missing/hidden element can't change the hook count).
  const visible = useIsVisible(element?.visible);
  const resolvedProps = useResolvedProps(element?.props ?? EMPTY_PROPS);
  if (!element || !visible) return null;

  const childKeys = element.children ?? [];
  const children =
    childKeys.length > 0
      ? childKeys.map((childKey) => (
          <ViewNode
            key={childKey}
            spec={spec}
            elementKey={childKey}
            onRefreshCard={onRefreshCard}
            isRefreshing={isRefreshing}
          />
        ))
      : undefined;

  const body = renderBody(
    element.type,
    resolvedProps,
    children,
    PLAIN_CTX,
    element.on as ElementOn | undefined,
  );

  if (element.type === "Card") {
    return (
      <CardRefreshFrame
        busy={isRefreshing}
        onRefresh={() => onRefreshCard(elementKey)}
      >
        {body}
      </CardRefreshFrame>
    );
  }
  return body;
}

function CardRefreshFrame({
  busy,
  onRefresh,
  children,
}: {
  busy: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    // h-full so a Card child fills the (stretched) grid cell instead of floating
    // short when a neighbour in the same row is taller.
    <Box className="group/card relative h-full">
      {children}
      <IconButton
        variant="ghost"
        color="gray"
        size="1"
        disabled={busy}
        aria-label="Refresh this card"
        onClick={onRefresh}
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/card:opacity-100"
      >
        <ArrowClockwiseIcon
          size={14}
          className={busy ? "motion-safe:animate-spin" : undefined}
        />
      </IconButton>
    </Box>
  );
}
