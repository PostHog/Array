import type { Spec } from "@json-render/react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  PLAIN_CTX,
  renderBody,
} from "@posthog/ui/features/canvas/genui/bodies";
import { useRefreshDashboard } from "@posthog/ui/features/canvas/hooks/useRefreshDashboard";
import { Box, IconButton } from "@radix-ui/themes";
import type { ReactNode } from "react";

// Read-only renderer for a saved dashboard. Mirrors the shared bodies (so it's
// pixel-identical to edit mode) but is a key-aware walk so each Card can carry a
// hover "refresh this card" button — createRenderer doesn't expose element keys.
export function ViewRenderer({
  spec,
  dashboardId,
}: {
  spec: Spec;
  dashboardId: string;
}) {
  const { refresh, isRefreshing } = useRefreshDashboard(dashboardId);
  return (
    <ViewNode
      spec={spec}
      elementKey={spec.root}
      onRefreshCard={(cardKey) => refresh({ elementKeys: [cardKey] })}
      isRefreshing={isRefreshing}
    />
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
  if (!element) return null;

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

  const body = renderBody(element.type, element.props, children, PLAIN_CTX);

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
    <Box className="group/card relative">
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
