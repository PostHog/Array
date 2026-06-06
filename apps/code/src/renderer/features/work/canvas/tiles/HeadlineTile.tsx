import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import {
  ArrowSquareOut,
  GaugeIcon,
  MagnifyingGlass,
  PencilSimple,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  HeadlineQueryRef,
  HeadlineTilePatch,
  HeadlineTile as HeadlineTileType,
} from "@shared/types/work-projects";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { openUrlInBrowser } from "@utils/browser";
import { memo, useMemo, useState } from "react";
import { TileFrame } from "../TileFrame";
import { InsightFrame } from "./headline/InsightFrame";

interface HeadlineTileProps {
  tile: HeadlineTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdate?: (patch: HeadlineTilePatch) => Promise<void>;
}

function HeadlineTileImpl({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
  onUpdate,
}: HeadlineTileProps) {
  const query = tile.query;
  const [picking, setPicking] = useState(false);

  if (!query || picking) {
    return (
      <InsightPicker
        tile={tile}
        currentGridSize={currentGridSize}
        onRemove={onRemove}
        onResizeGrid={onResizeGrid}
        onApplyPending={onApplyPending}
        onRejectPending={onRejectPending}
        onCancel={query ? () => setPicking(false) : undefined}
        onPick={async (picked) => {
          if (!onUpdate) return;
          await onUpdate({
            label: picked.label,
            liveLabel: picked.label,
            query: picked.query,
            posthogUrl: picked.posthogUrl,
            fallbackValue: picked.label ? "—" : undefined,
          });
          setPicking(false);
        }}
      />
    );
  }

  return (
    <LiveHeadline
      tile={tile}
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
      onEdit={onUpdate ? () => setPicking(true) : undefined}
    />
  );
}

interface LiveHeadlineProps {
  tile: HeadlineTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onEdit?: () => void;
}

function LiveHeadline({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
  onEdit,
}: LiveHeadlineProps) {
  const shareToken = tile.query?.shareToken;
  const label = shareToken ? (tile.liveLabel ?? tile.label) : tile.label;

  return (
    <TileFrame
      tile={tile}
      icon={GaugeIcon}
      label={label}
      headerAction={
        <Flex align="center" gap="2">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              title="Change insight"
              aria-label="Change insight"
              className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
            >
              <PencilSimple size={12} weight="duotone" />
            </button>
          )}
          {tile.posthogUrl && (
            <button
              type="button"
              onClick={() =>
                tile.posthogUrl && openUrlInBrowser(tile.posthogUrl)
              }
              className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
            >
              View in PostHog
              <ArrowSquareOut size={10} weight="bold" />
            </button>
          )}
        </Flex>
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      {shareToken ? (
        <InsightFrame shareToken={shareToken} posthogUrl={tile.posthogUrl} />
      ) : (
        <NoLiveDataBody tile={tile} />
      )}
    </TileFrame>
  );
}

/** Rendered when there's no PostHog sharing token to embed — the insight is
 *  real (the tile holds a query) but a share token was never minted (e.g. the
 *  mint failed at pick time, or the tile was proposed by the agent). We do NOT
 *  render the agent-estimated `fallback*` numbers here — they're not real data.
 *  Instead we point the user at the live insight in PostHog; the pencil "Change
 *  insight" action in the header lets them re-pick to mint a token.
 *  FOLLOW-UP: drop the `fallbackValue`/`fallbackDelta`/`fallbackSparkline`
 *  fields from HeadlineTileType + the MCP `propose_tile_headline` tool once no
 *  caller depends on them. */
function NoLiveDataBody({ tile }: { tile: HeadlineTileType }) {
  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="2"
      className="h-full px-4 py-3 text-center text-(--gray-10) text-[12px]"
    >
      <Text as="span">Live data isn't connected for this metric yet.</Text>
      {tile.posthogUrl && (
        <button
          type="button"
          onClick={() => tile.posthogUrl && openUrlInBrowser(tile.posthogUrl)}
          className="inline-flex items-center gap-1 text-(--gray-11) hover:text-(--gray-12)"
        >
          Open in PostHog
          <ArrowSquareOut size={10} weight="bold" />
        </button>
      )}
    </Flex>
  );
}

interface InsightSummary {
  id: number;
  short_id: string;
  name: string | null;
  derived_name: string | null;
  description: string | null;
  query: Record<string, unknown> | null;
}

interface PickedInsight {
  label: string;
  query: HeadlineQueryRef;
  posthogUrl: string;
}

interface InsightPickerProps {
  tile: HeadlineTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onCancel?: () => void;
  onPick: (picked: PickedInsight) => Promise<void>;
}

/** Pull the runnable query body out of an insight. PostHog wraps non-legacy
 *  insights in an `InsightVizNode` whose `source` is the actual TrendsQuery
 *  (or Funnels/Retention/etc); we unwrap that and return the inner node.
 *  Legacy `filters`-only insights (no `kind`) return null and are filtered
 *  out at the picker. */
function extractQueryBody(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!raw) return null;
  const kind = typeof raw.kind === "string" ? raw.kind : null;
  if (kind === "InsightVizNode" && typeof raw.source === "object") {
    return raw.source as Record<string, unknown>;
  }
  return kind ? raw : null;
}

/** Short kind chip shown next to each insight in the picker, e.g. "Trends",
 *  "Funnels". Expects an already-unwrapped body from `extractQueryBody`. */
function readKindLabel(body: Record<string, unknown>): string | null {
  const kind = typeof body.kind === "string" ? body.kind : null;
  return kind ? kind.replace(/Query$/, "") : null;
}

function displayName(insight: InsightSummary): string {
  const name = insight.name?.trim() || insight.derived_name?.trim();
  return name && name.length > 0 ? name : `Insight ${insight.short_id}`;
}

function InsightPicker({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
  onCancel,
  onPick,
}: InsightPickerProps) {
  const [search, setSearch] = useState("");
  const projectId = useAuthStateValue((s) => s.projectId);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const client = useOptionalAuthenticatedClient();
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useAuthenticatedQuery<
    InsightSummary[]
  >(
    ["work-project-headline-insight-search", projectId, search],
    (client) => {
      if (!projectId) return Promise.resolve([]);
      return client.searchInsights(projectId, {
        search: search.trim() || undefined,
        limit: 30,
      });
    },
    {
      enabled: !!projectId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  // Drop legacy `filters`-only insights with no runnable query body; everything
  // else is fair game and gets embedded via its sharing token.
  const filtered = useMemo(
    () => (data ?? []).filter((i) => extractQueryBody(i.query) !== null),
    [data],
  );

  const handlePick = async (insight: InsightSummary) => {
    if (!projectId || !cloudRegion || !client || picking) return;
    const body = extractQueryBody(insight.query);
    if (!body) return;
    setPicking(true);
    setPickError(null);
    try {
      const cloudUrl = getCloudUrlFromRegion(cloudRegion);
      let shareToken: string | undefined;
      try {
        const { accessToken } = await client.enableInsightSharing(
          projectId,
          insight.id,
        );
        shareToken = accessToken;
      } catch (err) {
        // We still want to land the pick so the user has a tile pointing at
        // their insight; the iframe falls back to the snapshot body. The
        // user can re-pick later (or hit "View in PostHog").
        setPickError(
          err instanceof Error
            ? `Couldn't enable preview: ${err.message}`
            : "Couldn't enable preview.",
        );
      }
      await onPick({
        label: displayName(insight),
        query: {
          posthogProjectId: projectId,
          body,
          insightShortId: insight.short_id,
          ...(shareToken ? { shareToken } : {}),
        },
        posthogUrl: `${cloudUrl}/project/${projectId}/insights/${insight.short_id}`,
      });
    } finally {
      setPicking(false);
    }
  };

  return (
    <TileFrame
      tile={tile}
      icon={GaugeIcon}
      label={tile.label || "Headline metric"}
      headerAction={
        onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-(--gray-10) text-[11px] hover:text-(--gray-12)"
          >
            Cancel
          </button>
        ) : undefined
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Flex direction="column" className="h-full min-h-0">
        {!projectId ? (
          <Flex
            align="center"
            justify="center"
            className="h-full px-4 py-3 text-center text-(--gray-10) text-[12px]"
          >
            Connect a PostHog project to pick an insight.
          </Flex>
        ) : (
          <>
            {pickError && (
              <Box className="shrink-0 border-(--red-5) border-b bg-(--red-2) px-3 py-1.5">
                <Text as="span" className="text-(--red-11) text-[11px]">
                  {pickError}
                </Text>
              </Box>
            )}
            <Box className="shrink-0 border-(--gray-4) border-b px-3 py-2">
              <Flex
                align="center"
                gap="2"
                className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1.5 focus-within:border-(--accent-7)"
              >
                <MagnifyingGlass
                  size={12}
                  weight="duotone"
                  className="shrink-0 text-(--gray-10)"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your PostHog insights…"
                  className="block w-full bg-transparent text-(--gray-12) text-[12px] outline-none placeholder:text-(--gray-9)"
                />
              </Flex>
            </Box>
            <Box className="scrollbar-overlay-y min-h-0 flex-1 overflow-y-auto">
              {isLoading && (data ?? []).length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-full px-4 py-6 text-(--gray-10) text-[12px]"
                >
                  Loading insights…
                </Flex>
              ) : isError ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-full px-4 py-6 text-center text-(--red-11) text-[12px]"
                >
                  {error instanceof Error
                    ? error.message
                    : "Couldn't load insights."}
                </Flex>
              ) : filtered.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-full px-4 py-6 text-center text-(--gray-10) text-[12px]"
                >
                  {search
                    ? `No insights match "${search}".`
                    : "No insights in this project yet."}
                </Flex>
              ) : (
                <Flex direction="column">
                  {filtered.map((insight) => {
                    const body = extractQueryBody(insight.query);
                    const kindLabel = body ? readKindLabel(body) : null;
                    return (
                      <button
                        key={insight.id}
                        type="button"
                        disabled={picking}
                        onClick={() => {
                          void handlePick(insight);
                        }}
                        className="flex w-full flex-col items-start gap-0.5 border-(--gray-3) border-b px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-(--gray-2) disabled:cursor-wait disabled:opacity-60"
                      >
                        <Flex align="center" gap="2" className="w-full min-w-0">
                          <Text
                            as="span"
                            className="min-w-0 truncate text-(--gray-12) text-[12px] leading-tight"
                          >
                            {displayName(insight)}
                          </Text>
                          {kindLabel && (
                            <Text
                              as="span"
                              className="shrink-0 rounded-(--radius-1) bg-(--gray-3) px-1 py-px text-(--gray-10) text-[10px] uppercase tracking-wide"
                            >
                              {kindLabel}
                            </Text>
                          )}
                        </Flex>
                        {insight.description && (
                          <Text
                            as="span"
                            className="truncate text-(--gray-10) text-[11px] leading-snug"
                          >
                            {insight.description}
                          </Text>
                        )}
                      </button>
                    );
                  })}
                </Flex>
              )}
            </Box>
          </>
        )}
      </Flex>
    </TileFrame>
  );
}

// Headline tile holds an iframe — memoize so we don't tear it down on every
// unrelated parent re-render. Compare by tile identity; `onUpdate` may change
// identity each render but the tile content is what drives expensive work.
export const HeadlineTile = memo(
  HeadlineTileImpl,
  (prev, next) => prev.tile === next.tile && prev.onUpdate === next.onUpdate,
);
