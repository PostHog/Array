import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { DotsThreeIcon, TrashIcon } from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Text,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { NewCanvasMenu } from "@posthog/ui/features/canvas/components/NewCanvasMenu";
import { FreeformCanvas } from "@posthog/ui/features/canvas/freeform/FreeformCanvas";
import { handleFreeformDataRequest } from "@posthog/ui/features/canvas/freeform/freeformDataBridge";
import { CanvasRenderer } from "@posthog/ui/features/canvas/genui/registry";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import {
  useDashboardMutations,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useSeedShowcase } from "@posthog/ui/features/canvas/hooks/useSeedShowcase";
import { useInView } from "@posthog/ui/primitives/hooks/useInView";
import { toast } from "@posthog/ui/primitives/toast";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { memo, useState } from "react";

// Render each dashboard's live spec at 1/SCALE of the card width, then shrink so
// the full layout fits inside the fixed-height preview frame as a thumbnail.
const PREVIEW_SCALE = 0.4;

// Mount a preview only while it's near the viewport, and UNMOUNT it once it
// scrolls away (once: false). This caps how many full preview trees / sandbox
// iframes are live at any time, so a channel with many large canvases doesn't
// accumulate pages of off-screen DOM. The margin pre-mounts a little early so
// scrolling doesn't flash an empty frame. The fixed-height frame keeps the
// layout stable across mount/unmount (no scroll jump).
const PREVIEW_VIEWPORT = { once: false, rootMargin: "400px 0px" } as const;

// A channel's dashboards index: a grid of cards, each showing a scaled-down
// live preview. Clicking a card opens the full dashboard.
export function WebsiteDashboardsIndex({ channelId }: { channelId: string }) {
  const { dashboards, isLoading } = useDashboards(channelId);
  // Seed the built-in component showcase into this channel on first visit.
  useSeedShowcase(channelId);

  // templateId -> display name, for the per-card badge ("Dashboard", "Freeform
  // (React)", …). Falls back to the raw id for any template not in the registry.
  const templates = useCanvasTemplates();
  const templateLabels = new Map(templates.map((t) => [t.id, t.name]));

  if (isLoading) return null;

  if (dashboards.length === 0) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        height="100%"
        gap="3"
        className="px-6 text-center"
      >
        <Flex direction="column" gap="1">
          <Text size="lg" weight="semibold">
            No canvases yet
          </Text>
          <Text size="sm" variant="muted">
            Create one and build it with the agent, then save it.
          </Text>
        </Flex>
        <NewCanvasMenu channelId={channelId} variant="primary" />
      </Flex>
    );
  }

  return (
    <div className="scroll-mask-4 h-full overflow-auto bg-gray-1">
      <Box className="p-5">
        <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="4">
          {dashboards.map((d) => (
            <DashboardCard
              key={d.id}
              channelId={channelId}
              summary={d}
              templateLabel={templateLabels.get(d.templateId) ?? d.templateId}
            />
          ))}
        </Grid>
      </Box>
    </div>
  );
}

const DashboardCard = memo(function DashboardCard({
  channelId,
  summary,
  templateLabel,
}: {
  channelId: string;
  summary: DashboardSummary;
  templateLabel: string;
}) {
  // The spec (json-render) or code (freeform) rides along in the list response,
  // so the grid renders previews without a per-card fetch (no N+1 of get()).
  const spec = summary.spec as Spec | null | undefined;
  const isFreeform = summary.kind === "freeform";

  return (
    <Box className="group relative">
      <Link
        to="/website/$channelId/dashboards/$dashboardId"
        params={{ channelId, dashboardId: summary.id }}
        className="no-underline"
      >
        <Card className="gap-0 overflow-hidden p-0">
          {isFreeform ? (
            <FreeformPreview code={summary.code} />
          ) : (
            <DashboardPreview spec={spec} />
          )}
          <CardContent className="flex flex-col gap-0.5 p-3">
            <Flex align="center" justify="between" gap="2">
              <Text size="sm" weight="medium" className="truncate">
                {summary.name}
              </Text>
              <Badge>{templateLabel}</Badge>
            </Flex>
            <Text size="xxs" variant="muted">
              Updated {formatRelativeTimeShort(summary.updatedAt)}
            </Text>

            <Text size="xxs" variant="muted">
              Created by{" "}
              {summary.createdBy ? `${summary.createdBy}` : "Unknown"}
            </Text>
          </CardContent>
        </Card>
      </Link>
      {/* Sibling of the Link (not nested) so opening the menu or deleting never
          navigates into the dashboard. */}
      <DashboardCardMenu id={summary.id} name={summary.name} />
    </Box>
  );
});

// The scaled-down preview frame. The full chart tree is expensive to mount, so
// we defer rendering it until the card scrolls near the viewport (`once` keeps
// it mounted afterward). Off-screen cards in a long grid stay cheap.
function DashboardPreview({ spec }: { spec: Spec | null | undefined }) {
  const [ref, inView] = useInView<HTMLDivElement>(PREVIEW_VIEWPORT);

  return (
    <Box
      ref={ref}
      className="relative h-44 overflow-hidden border-border border-b bg-muted"
    >
      {isNonEmptySpec(spec) ? (
        inView ? (
          <Box
            className="pointer-events-none absolute top-0 left-0 origin-top-left"
            style={{
              transform: `scale(${PREVIEW_SCALE})`,
              width: `${100 / PREVIEW_SCALE}%`,
            }}
          >
            <ErrorBoundary
              name="dashboard-preview"
              resetKey={spec}
              fallback={<PreviewPlaceholder label="Preview unavailable" />}
            >
              <CanvasRenderer spec={spec} state={spec.state} />
            </ErrorBoundary>
          </Box>
        ) : (
          <PreviewPlaceholder label="Loading preview…" />
        )
      ) : (
        <PreviewPlaceholder label="Empty canvas" />
      )}
    </Box>
  );
}

// Preview data handler for freeform cards: swallow captures so a thumbnail never
// emits analytics events, but still let queries through so the preview shows
// real-ish content. (posthog-js itself is never booted — no `analytics` prop —
// so there's no autocapture/pageview/replay from previews either.)
function previewDataRequest(
  method: string,
  payload: unknown,
): Promise<unknown> {
  if (method === "capture") return Promise.resolve({ ok: true });
  return handleFreeformDataRequest(method, payload);
}

// A freeform (React-in-iframe) canvas preview: the app rendered at PREVIEW_SCALE
// in a clipped frame, the same shape as DashboardPreview. Deferred until near
// the viewport, and runs with NO analytics so it fires no events.
function FreeformPreview({ code }: { code?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>(PREVIEW_VIEWPORT);

  return (
    <Box
      ref={ref}
      className="relative h-44 overflow-hidden border-border border-b bg-muted"
    >
      {code ? (
        inView ? (
          <Box
            className="pointer-events-none absolute top-0 left-0 origin-top-left"
            style={{
              transform: `scale(${PREVIEW_SCALE})`,
              width: `${100 / PREVIEW_SCALE}%`,
              // Fixed tall content height so the scaled iframe has something to
              // fill before its first resize message arrives; the frame clips it.
              height: 600,
            }}
          >
            <ErrorBoundary
              name="freeform-preview"
              resetKey={code}
              fallback={<PreviewPlaceholder label="Preview unavailable" />}
            >
              <FreeformCanvas
                code={code}
                mode="edit"
                onDataRequest={previewDataRequest}
              />
            </ErrorBoundary>
          </Box>
        ) : (
          <PreviewPlaceholder label="Loading preview…" />
        )
      ) : (
        <PreviewPlaceholder label="Empty canvas" />
      )}
    </Box>
  );
}

function DashboardCardMenu({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { deleteDashboard, isDeleting } = useDashboardMutations();

  const onDelete = () => {
    deleteDashboard(id).catch((error) => {
      toast.error("Couldn't delete canvas", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return (
    <Box
      className={cn(
        "absolute top-2 right-2 transition-opacity",
        open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={`Options for ${name}`}
            >
              <DotsThreeIcon size={16} weight="bold" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
          <DropdownMenuItem
            variant="destructive"
            disabled={isDeleting}
            onClick={onDelete}
          >
            <TrashIcon size={14} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Box>
  );
}

function PreviewPlaceholder({ label }: { label: string }) {
  return (
    <Flex
      align="center"
      justify="center"
      className="absolute inset-0 text-center"
    >
      <Text size="xs" variant="muted">
        {label}
      </Text>
    </Flex>
  );
}
