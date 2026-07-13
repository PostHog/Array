import {
  Archive,
  CaretDown,
  CaretRight,
  Cloud as CloudIcon,
  GitBranch as GitBranchIcon,
  Laptop as LaptopIcon,
} from "@phosphor-icons/react";
import {
  type ArchivedTaskWithDetails,
  formatRelativeDate,
  getRepoName,
} from "@posthog/core/archive/archiveListView";
import type { WorkspaceMode } from "@posthog/shared";
import { useHomeUiStore } from "@posthog/ui/features/home/stores/homeUiStore";
import { navigateToArchived } from "@posthog/ui/router/navigationBridge";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { Box, Flex, Text } from "@radix-ui/themes";

// Cap rows shown inline; the full searchable list lives in ArchivedTasksView.
const INLINE_LIMIT = 8;

function ModeGlyph({ mode }: { mode: WorkspaceMode }) {
  const Icon =
    mode === "cloud"
      ? CloudIcon
      : mode === "worktree"
        ? GitBranchIcon
        : LaptopIcon;
  return <Icon size={14} className="shrink-0 text-gray-10" />;
}

interface HomeArchivedSectionProps {
  items: ArchivedTaskWithDetails[];
}

export function HomeArchivedSection({ items }: HomeArchivedSectionProps) {
  const expanded = useHomeUiStore((s) => s.archivedExpanded);
  const toggleExpanded = useHomeUiStore((s) => s.toggleArchivedExpanded);

  if (items.length === 0) return null;

  const visible = items.slice(0, INLINE_LIMIT);
  const hiddenCount = items.length - visible.length;

  return (
    <Box>
      <Flex
        align="center"
        gap="2"
        className="sticky top-0 z-10 border-(--gray-3) border-b bg-(--color-panel-solid) px-4 py-2"
      >
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex min-w-0 items-center gap-2 bg-transparent text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <CaretDown size={11} weight="bold" className="text-(--gray-10)" />
          ) : (
            <CaretRight size={11} weight="bold" className="text-(--gray-10)" />
          )}
          <Archive size={13} weight="fill" className="text-(--gray-11)" />
          <Text className="font-semibold text-[12px] text-gray-12">
            Archived
          </Text>
          <Text className="rounded-full bg-(--gray-a3) px-1.5 py-px font-medium text-(--gray-11) text-[10.5px] tabular-nums">
            {items.length}
          </Text>
        </button>
        <button
          type="button"
          onClick={navigateToArchived}
          className="ml-auto bg-transparent text-(--gray-10) text-[11px] transition-colors hover:text-(--gray-12)"
        >
          View all
        </button>
      </Flex>

      {expanded ? (
        <>
          {visible.map((item) => (
            <HomeArchivedRow key={item.archived.taskId} item={item} />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={navigateToArchived}
              className="w-full bg-transparent px-4 py-2 text-left text-(--gray-10) text-[12px] transition-colors hover:bg-(--gray-2) hover:text-(--gray-12)"
            >
              View {hiddenCount} more in Archive
            </button>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function HomeArchivedRow({ item }: { item: ArchivedTaskWithDetails }) {
  const { task, archived } = item;
  const title = task?.title ?? "Unknown task";
  const repoName = getRepoName(task?.repository);

  const onOpen = () => {
    if (task) {
      void openTask(task);
    } else {
      navigateToArchived();
    }
  };

  return (
    <Box
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${title}`}
      className="group flex cursor-pointer items-center gap-3 border-(--gray-3) border-b py-2 pr-3 pl-4 transition-colors hover:bg-(--gray-2)"
    >
      <ModeGlyph mode={archived.mode} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[13px] text-gray-11 group-hover:text-gray-12"
          title={title}
        >
          {title}
        </span>
        {repoName !== "—" ? (
          <span className="truncate text-(--gray-9) text-[11px]">
            {repoName}
          </span>
        ) : null}
      </div>
      <Text className="shrink-0 text-(--gray-9) text-[11px]">
        {formatRelativeDate(archived.archivedAt)}
      </Text>
    </Box>
  );
}
