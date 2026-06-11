import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { DotsThreeIcon, TrashIcon } from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
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
import { CanvasRenderer } from "@posthog/ui/features/canvas/genui/registry";
import {
  useDashboardMutations,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useSeedShowcase } from "@posthog/ui/features/canvas/hooks/useSeedShowcase";
import { toast } from "@posthog/ui/primitives/toast";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { Box, Flex, Grid, ScrollArea } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

// Render each dashboard's live spec at 1/SCALE of the card width, then shrink so
// the full layout fits inside the fixed-height preview frame as a thumbnail.
const PREVIEW_SCALE = 0.4;

// A channel's dashboards index: a grid of cards, each showing a scaled-down
// live preview. Clicking a card opens the full dashboard.
export function WebsiteDashboardsIndex({ channelId }: { channelId: string }) {
  const { dashboards, isLoading } = useDashboards(channelId);
  // Seed the built-in component showcase into this channel on first visit.
  useSeedShowcase(channelId);

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
    <ScrollArea className="h-full bg-gray-1">
      <Box className="p-5">
        <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="4">
          {dashboards.map((d) => (
            <DashboardCard key={d.id} channelId={channelId} summary={d} />
          ))}
        </Grid>
      </Box>
    </ScrollArea>
  );
}

function DashboardCard({
  channelId,
  summary,
}: {
  channelId: string;
  summary: DashboardSummary;
}) {
  // The spec rides along in the list response, so the grid renders previews
  // without a per-card fetch (no N+1 of dashboards.get).
  const spec = summary.spec as Spec | null | undefined;

  return (
    <Box className="group relative">
      <Link
        to="/website/$channelId/dashboards/$dashboardId"
        params={{ channelId, dashboardId: summary.id }}
        className="no-underline"
      >
        <Card className="gap-0 overflow-hidden p-0">
          <Box className="relative h-44 overflow-hidden border-border border-b bg-muted">
            {isNonEmptySpec(spec) ? (
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
              <PreviewPlaceholder label="Empty canvas" />
            )}
          </Box>
          <CardContent className="flex flex-col gap-0.5 p-3">
            <Text size="sm" weight="medium" className="truncate">
              {summary.name}
            </Text>
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
