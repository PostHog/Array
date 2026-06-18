import {
  CircleHalf,
  Graph,
  House,
  Kanban,
  ListBullets,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { useHomeSnapshot } from "@posthog/ui/features/home/hooks/useHomeSnapshot";
import {
  type HomeViewMode,
  useHomeUiStore,
} from "@posthog/ui/features/home/stores/homeUiStore";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { DotsCircleSpinner } from "@posthog/ui/primitives/DotsCircleSpinner";
import { Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useEffect, useMemo } from "react";
import { ConfigMap } from "../config/ConfigMap";
import { HomeActiveAgentsStrip } from "./HomeActiveAgentsStrip";
import { HomeBoardView } from "./HomeBoardView";
import { HomeEmptyState } from "./HomeEmptyState";
import { HomeWorkstreamDetailPanel } from "./HomeWorkstreamDetailPanel";
import { HomeWorkstreamRow } from "./HomeWorkstreamRow";

const VIEW_CYCLE: HomeViewMode[] = ["list", "board", "config"];

const HEADER_CONTENT = (
  <Flex align="center" gap="2" className="w-full min-w-0">
    <House size={12} className="shrink-0 text-gray-10" />
    <Text
      className="truncate whitespace-nowrap font-medium text-[13px]"
      title="Home"
    >
      Home
    </Text>
  </Flex>
);

export function HomeView() {
  const { snapshot, isLoading } = useHomeSnapshot();
  const viewMode = useHomeUiStore((s) => s.viewMode);
  const setViewMode = useHomeUiStore((s) => s.setViewMode);
  const selectedWorkstreamId = useHomeUiStore((s) => s.selectedWorkstreamId);
  const setSelectedWorkstreamId = useHomeUiStore(
    (s) => s.setSelectedWorkstreamId,
  );

  useSetHeaderContent(HEADER_CONTENT);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selectedWorkstreamId) setSelectedWorkstreamId(null);
        return;
      }
      if (e.key !== "v" || e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't capture `v` while the user is typing.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      const idx = VIEW_CYCLE.indexOf(viewMode);
      setViewMode(VIEW_CYCLE[(idx + 1) % VIEW_CYCLE.length] ?? "list");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, setViewMode, selectedWorkstreamId, setSelectedWorkstreamId]);

  const { activeAgents, needsAttention, inProgress } = snapshot;
  const selectedWorkstream = useMemo(
    () =>
      selectedWorkstreamId
        ? (needsAttention.find((ws) => ws.id === selectedWorkstreamId) ??
          inProgress.find((ws) => ws.id === selectedWorkstreamId) ??
          null)
        : null,
    [selectedWorkstreamId, needsAttention, inProgress],
  );

  if (isLoading) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <DotsCircleSpinner size={16} className="text-gray-10" />
      </Flex>
    );
  }

  const totalRows = needsAttention.length + inProgress.length;
  const hasContent = activeAgents.length > 0 || totalRows > 0;

  return (
    <Flex direction="column" className="h-full">
      <Box className="border-(--gray-4) border-b px-5 py-3">
        <Flex align="center" justify="between" gap="3">
          <Flex direction="column" gap="1" className="min-w-0">
            <Flex align="center" gap="2">
              <Text className="font-semibold text-[15px] text-gray-12">
                Home
              </Text>
            </Flex>
            {hasContent ? (
              <Flex align="center" gap="5" className="text-[12px]">
                {needsAttention.length > 0 ? (
                  <Stat
                    color="var(--amber-9)"
                    label={`${needsAttention.length} need${needsAttention.length === 1 ? "s" : ""} attention`}
                  />
                ) : null}
                {activeAgents.length > 0 ? (
                  <Stat
                    color="var(--green-9)"
                    label={`${activeAgents.length} running`}
                    pulse
                  />
                ) : null}
                {inProgress.length > 0 ? (
                  <Stat
                    color="var(--blue-9)"
                    label={`${inProgress.length} in progress`}
                  />
                ) : null}
              </Flex>
            ) : (
              <Text className="text-(--gray-11) text-[12px]">
                You're caught up
              </Text>
            )}
          </Flex>
          <Flex align="center" gap="2" className="shrink-0">
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
          </Flex>
        </Flex>
      </Box>

      {viewMode === "config" ? (
        <Box className="min-h-0 flex-1">
          <ConfigMap />
        </Box>
      ) : (
        <>
          <HomeActiveAgentsStrip agents={activeAgents} />
          <Flex className="min-h-0 flex-1">
            <Box className="min-w-0 flex-1">
              {!hasContent ? (
                <HomeEmptyState hasRunningAgents={activeAgents.length > 0} />
              ) : viewMode === "board" ? (
                <Box className="h-full min-h-0">
                  <HomeBoardView snapshot={snapshot} />
                </Box>
              ) : (
                <ScrollArea scrollbars="vertical">
                  {needsAttention.length > 0 ? (
                    <Section
                      title="Needs attention"
                      icon={
                        <Warning
                          size={13}
                          weight="fill"
                          className="text-(--amber-11)"
                        />
                      }
                      count={needsAttention.length}
                    >
                      {needsAttention.map((ws) => (
                        <HomeWorkstreamRow key={ws.id} workstream={ws} />
                      ))}
                    </Section>
                  ) : null}

                  {inProgress.length > 0 ? (
                    <Section
                      title="In progress"
                      icon={
                        <CircleHalf
                          size={13}
                          weight="fill"
                          className="text-(--blue-11)"
                        />
                      }
                      count={inProgress.length}
                    >
                      {inProgress.map((ws) => (
                        <HomeWorkstreamRow key={ws.id} workstream={ws} />
                      ))}
                    </Section>
                  ) : null}

                  {totalRows === 0 && activeAgents.length > 0 ? (
                    <HomeEmptyState hasRunningAgents />
                  ) : null}
                </ScrollArea>
              )}
            </Box>
            {selectedWorkstream ? (
              <Box className="w-[400px] shrink-0 border-(--gray-4) border-l">
                <HomeWorkstreamDetailPanel
                  workstream={selectedWorkstream}
                  onClose={() => setSelectedWorkstreamId(null)}
                />
              </Box>
            ) : null}
          </Flex>
        </>
      )}
    </Flex>
  );
}

interface SectionProps {
  title: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

interface ViewModeToggleProps {
  value: HomeViewMode;
  onChange: (next: HomeViewMode) => void;
}

function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <Flex
      align="center"
      gap="1"
      className="shrink-0 rounded-md border border-(--gray-4) bg-(--gray-2) p-0.5"
      title="Switch view (press v to cycle)"
    >
      <Button
        size="sm"
        variant={value === "list" ? "primary" : "link-muted"}
        onClick={() => onChange("list")}
      >
        <ListBullets size={14} />
        List
      </Button>
      <Button
        size="sm"
        variant={value === "board" ? "primary" : "link-muted"}
        onClick={() => onChange("board")}
      >
        <Kanban size={14} />
        Board
      </Button>
      <Button
        size="sm"
        variant={value === "config" ? "primary" : "link-muted"}
        onClick={() => onChange("config")}
      >
        <Graph size={14} />
        Config
      </Button>
    </Flex>
  );
}

function Stat({
  color,
  label,
  pulse = false,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <Flex align="center" gap="2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      <Text className="text-(--gray-11) text-[12px]">{label}</Text>
    </Flex>
  );
}

function Section({ title, count, icon, children }: SectionProps) {
  return (
    <Box>
      <Flex
        align="center"
        gap="2"
        className="sticky top-0 z-10 border-(--gray-3) border-b bg-(--color-panel-solid) px-4 py-2"
      >
        {icon}
        <Text className="font-semibold text-[12px] text-gray-12">{title}</Text>
        {count > 0 && (
          <Text className="rounded-full bg-(--gray-a3) px-1.5 py-px font-medium text-(--gray-11) text-[10.5px] tabular-nums">
            {count}
          </Text>
        )}
      </Flex>
      {children}
    </Box>
  );
}
