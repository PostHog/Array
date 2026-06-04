import { ErrorBoundary } from "@components/ErrorBoundary";
import { CanvasRenderer } from "@features/canvas/genui/registry";
import {
  useCreateAndOpenDashboard,
  useDashboard,
  useDashboardMutations,
  useDashboards,
} from "@features/canvas/hooks/useDashboards";
import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import type { DashboardSummary } from "@main/services/dashboards/schemas";
import { DotsThreeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { Box, Flex, Grid, ScrollArea, Text } from "@radix-ui/themes";
import { toast } from "@renderer/utils/toast";
import { Link } from "@tanstack/react-router";
import { formatRelativeTimeShort } from "@utils/time";
import { useState } from "react";

// Render each dashboard's live spec at 1/SCALE of the card width, then shrink so
// the full layout fits inside the fixed-height preview frame as a thumbnail.
const PREVIEW_SCALE = 0.4;

// /website index: a grid of dashboard cards, each showing a scaled-down live
// preview. Clicking a card opens the full dashboard.
export function WebsiteDashboardsIndex() {
  const { dashboards, isLoading } = useDashboards();
  const createAndOpen = useCreateAndOpenDashboard();

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
          <Text size="3" weight="bold" className="text-gray-12">
            No dashboards yet
          </Text>
          <Text size="2" className="text-gray-10">
            Create one and build it with the agent, then save it.
          </Text>
        </Flex>
        <Button variant="primary" onClick={() => void createAndOpen()}>
          <PlusIcon size={14} />
          Create dashboard
        </Button>
      </Flex>
    );
  }

  return (
    <ScrollArea className="h-full bg-gray-1">
      <Box className="p-5">
        <Flex align="center" justify="between" className="mb-4">
          <Text size="3" weight="bold" className="text-gray-12">
            Dashboards
          </Text>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void createAndOpen()}
          >
            <PlusIcon size={14} />
            New dashboard
          </Button>
        </Flex>
        <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="4">
          {dashboards.map((d) => (
            <DashboardCard key={d.id} summary={d} />
          ))}
        </Grid>
      </Box>
    </ScrollArea>
  );
}

function DashboardCard({ summary }: { summary: DashboardSummary }) {
  const { dashboard, isLoading } = useDashboard(summary.id);
  const spec = dashboard?.spec as Spec | null | undefined;

  return (
    <Box className="group relative">
      <Link
        to="/website/dashboards/$dashboardId"
        params={{ dashboardId: summary.id }}
        className="no-underline"
      >
        <Flex
          direction="column"
          className="overflow-hidden rounded-lg border border-gray-6 bg-gray-2 transition-colors hover:border-gray-8"
        >
          <Box className="relative h-44 overflow-hidden border-gray-6 border-b bg-gray-1">
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
                  <CanvasRenderer spec={spec} />
                </ErrorBoundary>
              </Box>
            ) : (
              <PreviewPlaceholder label={isLoading ? "" : "Empty dashboard"} />
            )}
          </Box>
          <Flex direction="column" gap="1" className="p-3">
            <Text size="2" weight="medium" className="truncate text-gray-12">
              {summary.name}
            </Text>
            <Text size="1" className="text-gray-10">
              Updated {formatRelativeTimeShort(summary.updatedAt)}
            </Text>
          </Flex>
        </Flex>
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
      toast.error("Couldn't delete dashboard", {
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
      <Text size="1" className="text-gray-9">
        {label}
      </Text>
    </Flex>
  );
}
