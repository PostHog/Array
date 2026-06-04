import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import { Tooltip } from "@components/ui/Tooltip";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { openTask } from "@hooks/useOpenTask";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import type { WorkspaceMode } from "@main/services/workspace/schemas";
import {
  CaretDown,
  CaretUp,
  Check,
  Cloud as CloudIcon,
  GitBranch as GitBranchIcon,
  Laptop as LaptopIcon,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Box,
  Button,
  Dialog,
  Flex,
  Popover,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc";
import type { Task } from "@shared/types";
import type { ArchivedTask } from "@shared/types/archive";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatRelativeTimeLong } from "@utils/time";
import { toast } from "@utils/toast";
import { useMemo, useState } from "react";

const BRANCH_NOT_FOUND_PATTERN = /Branch '(.+)' does not exist/;

function formatRelativeDate(isoDate: string | undefined): string {
  if (!isoDate) return "—";
  return formatRelativeTimeLong(isoDate);
}

function getRepoName(repository: string | null | undefined): string {
  return repository?.split("/").pop() ?? "—";
}

const ICON_SIZE = 12;

function ModeIcon({ mode }: { mode: WorkspaceMode }) {
  if (mode === "cloud") {
    return (
      <Tooltip content="Cloud">
        <span className="flex items-center justify-center">
          <CloudIcon size={ICON_SIZE} className="text-gray-10" />
        </span>
      </Tooltip>
    );
  }
  if (mode === "worktree") {
    return (
      <Tooltip content="Worktree">
        <span className="flex items-center justify-center">
          <GitBranchIcon size={ICON_SIZE} className="text-gray-10" />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Local">
      <span className="flex items-center justify-center">
        <LaptopIcon size={ICON_SIZE} className="text-gray-10" />
      </span>
    </Tooltip>
  );
}

type SortColumn = "created" | "archived";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

function SortableColumnHeader({
  column,
  label,
  sort,
  onSort,
  width,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  width?: string;
}) {
  const isActive = sort.column === column;
  return (
    <Table.ColumnHeaderCell
      className="font-normal text-[13px] text-gray-11"
      style={width ? { width } : undefined}
    >
      <button
        type="button"
        className="inline-flex items-center gap-0.5 text-gray-11 transition-colors hover:text-gray-12"
        onClick={() => onSort(column)}
      >
        {label}
        {isActive &&
          (sort.direction === "asc" ? (
            <CaretUp size={10} weight="fill" />
          ) : (
            <CaretDown size={10} weight="fill" />
          ))}
      </button>
    </Table.ColumnHeaderCell>
  );
}

const filterItemClassName =
  "flex w-full items-center justify-between rounded-sm px-1.5 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3";

function RepositoryFilterHeader({
  repos,
  selectedRepo,
  onSelect,
}: {
  repos: string[];
  selectedRepo: string | null;
  onSelect: (repo: string | null) => void;
}) {
  return (
    <Table.ColumnHeaderCell className="w-[20%] font-normal text-[13px] text-gray-11">
      <Popover.Root>
        <Popover.Trigger>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-gray-11 transition-colors hover:text-gray-12"
          >
            Repository
            <CaretDown size={10} />
            {selectedRepo !== null && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-9" />
            )}
          </button>
        </Popover.Trigger>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          className="min-w-[180px] p-[6px]"
        >
          <Flex direction="column" gap="0">
            <button
              type="button"
              className={filterItemClassName}
              onClick={() => onSelect(null)}
            >
              <span>All repositories</span>
              {selectedRepo === null && (
                <Check size={12} className="text-gray-12" />
              )}
            </button>
            {repos.map((repo) => (
              <button
                key={repo}
                type="button"
                className={filterItemClassName}
                onClick={() => onSelect(repo)}
              >
                <span className="max-w-[200px] truncate">{repo}</span>
                {selectedRepo === repo && (
                  <Check size={12} className="text-gray-12" />
                )}
              </button>
            ))}
          </Flex>
        </Popover.Content>
      </Popover.Root>
    </Table.ColumnHeaderCell>
  );
}

interface BranchNotFoundPrompt {
  taskId: string;
  branchName: string;
}

export interface ArchivedTaskWithDetails {
  archived: ArchivedTask;
  task: Task | null;
}

export interface ArchivedTasksViewPresentationProps {
  items: ArchivedTaskWithDetails[];
  isLoading: boolean;
  branchNotFound: BranchNotFoundPrompt | null;
  onUnarchive: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onContextMenu: (item: ArchivedTaskWithDetails, e: React.MouseEvent) => void;
  onBranchNotFoundClose: () => void;
  onRecreateBranch: () => void;
}

export function ArchivedTasksViewPresentation({
  items,
  isLoading,
  branchNotFound,
  onUnarchive,
  onDelete,
  onContextMenu,
  onBranchNotFoundClose,
  onRecreateBranch,
}: ArchivedTasksViewPresentationProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState>({
    column: "archived",
    direction: "desc",
  });
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleSort = (column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "desc" },
    );
  };

  const itemsWithRepo = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        repoName: getRepoName(item.task?.repository),
      })),
    [items],
  );

  const uniqueRepos = useMemo(() => {
    const repos = new Set<string>();
    for (const item of itemsWithRepo) {
      if (item.repoName !== "—") repos.add(item.repoName);
    }
    return [...repos].sort((a, b) => a.localeCompare(b));
  }, [itemsWithRepo]);

  const filteredItems = useMemo(() => {
    let result = itemsWithRepo;

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((item) =>
        (item.task?.title?.toLowerCase() ?? "").includes(query),
      );
    }

    if (repoFilter) {
      result = result.filter((item) => item.repoName === repoFilter);
    }

    const dir = sort.direction === "asc" ? 1 : -1;

    return [...result].sort((a, b) => {
      const aTime =
        sort.column === "created"
          ? a.task?.created_at
            ? new Date(a.task.created_at).getTime()
            : 0
          : new Date(a.archived.archivedAt).getTime();
      const bTime =
        sort.column === "created"
          ? b.task?.created_at
            ? new Date(b.task.created_at).getTime()
            : 0
          : new Date(b.archived.archivedAt).getTime();
      return dir * (aTime - bTime);
    });
  }, [itemsWithRepo, searchQuery, repoFilter, sort]);

  return (
    <Flex direction="column" height="100%">
      <Box
        className="flex-1 overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <Box px="3" pt="3" pb="2">
          <TextField.Root
            size="2"
            placeholder="Search archived tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-[13px]"
          >
            <TextField.Slot>
              <MagnifyingGlass size={14} />
            </TextField.Slot>
          </TextField.Root>
        </Box>

        {isLoading ? (
          <Flex align="center" justify="center" gap="2" py="8">
            <DotsCircleSpinner size={16} className="text-gray-10" />
            <Text className="text-[13px] text-gray-10">
              Loading archived tasks...
            </Text>
          </Flex>
        ) : filteredItems.length === 0 ? (
          <Flex align="center" justify="center" py="8">
            <Text className="text-[13px] text-gray-10">
              {items.length === 0 ? "No archived tasks" : "No matching tasks"}
            </Text>
          </Flex>
        ) : (
          <Table.Root
            size="1"
            className="[&_td]:!py-1.5 [&_th]:!py-1.5 [&_table]:w-full [&_table]:table-fixed [&_tbody_tr:hover]:bg-gray-4 [&_td]:overflow-hidden [&_td]:align-middle [&_th]:align-middle"
          >
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell className="w-[40%] font-normal text-[13px] text-gray-11">
                  Title
                </Table.ColumnHeaderCell>
                <SortableColumnHeader
                  column="created"
                  label="Created"
                  sort={sort}
                  onSort={handleSort}
                  width="15%"
                />
                <SortableColumnHeader
                  column="archived"
                  label="Archived"
                  sort={sort}
                  onSort={handleSort}
                  width="15%"
                />
                <RepositoryFilterHeader
                  repos={uniqueRepos}
                  selectedRepo={repoFilter}
                  onSelect={setRepoFilter}
                />
                <Table.ColumnHeaderCell className="w-[160px]" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredItems.map((item) => (
                <Table.Row
                  key={item.archived.taskId}
                  onContextMenu={(e) => onContextMenu(item, e)}
                  className="group"
                >
                  <Table.Cell>
                    <Flex align="center" gap="2">
                      <ModeIcon mode={item.archived.mode} />
                      <Text className="block truncate text-[13px]">
                        {item.task?.title ?? "Unknown task"}
                      </Text>
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="block whitespace-nowrap text-[13px] text-gray-11">
                      {formatRelativeDate(item.task?.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="block whitespace-nowrap text-[13px] text-gray-11">
                      {formatRelativeDate(item.archived.archivedAt)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="block truncate text-[13px] text-gray-11">
                      {item.repoName}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="overflow-visible">
                    <Flex gap="2" className="invisible group-hover:visible">
                      <Button
                        variant="outline"
                        color="gray"
                        size="1"
                        onClick={() => onUnarchive(item.archived.taskId)}
                      >
                        Unarchive
                      </Button>
                      <Button
                        variant="outline"
                        color="red"
                        size="1"
                        onClick={() => setDeleteTargetId(item.archived.taskId)}
                      >
                        Delete
                      </Button>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Box>

      <Dialog.Root
        open={branchNotFound !== null}
        onOpenChange={(open) => {
          if (!open) onBranchNotFoundClose();
        }}
      >
        <Dialog.Content maxWidth="420px" size="1">
          <Dialog.Title className="text-sm">
            Unarchive to new branch?
          </Dialog.Title>
          <Dialog.Description className="text-[13px]">
            <Text color="gray" className="text-[13px]">
              This workspace was last on{" "}
              <Text className="font-medium text-[13px]">
                {branchNotFound?.branchName}
              </Text>
              , but that branch has been deleted or renamed.
            </Text>
          </Dialog.Description>
          <Flex justify="end" gap="3" mt="3">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="1">
                Cancel
              </Button>
            </Dialog.Close>
            <Button size="1" onClick={onRecreateBranch}>
              Unarchive to new branch
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
      >
        <AlertDialog.Content maxWidth="420px" size="1">
          <AlertDialog.Title className="text-sm">
            Delete archived task
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[13px]">
            <Text color="gray" className="text-[13px]">
              Permanently delete{" "}
              <Text className="font-medium text-[13px]">
                {items.find((i) => i.archived.taskId === deleteTargetId)?.task
                  ?.title ?? "Unknown task"}
              </Text>
              ? This cannot be undone.
            </Text>
          </AlertDialog.Description>
          <Flex justify="end" gap="3" mt="3">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" size="1">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                size="1"
                onClick={() => {
                  if (deleteTargetId) onDelete(deleteTargetId);
                  setDeleteTargetId(null);
                }}
              >
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

export function ArchivedTasksView() {
  const trpcReact = useTRPC();
  const { data: archivedTasks = [], isLoading: isLoadingArchived } = useQuery(
    trpcReact.archive.list.queryOptions(),
  );
  const { data: tasks = [], isLoading: isLoadingTasks } = useTasks();
  const queryClient = useQueryClient();

  useSetHeaderContent(
    <Text className="font-medium text-[13px]">Archived tasks</Text>,
  );

  const [branchNotFound, setBranchNotFound] =
    useState<BranchNotFoundPrompt | null>(null);

  const items = useMemo(() => {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    return archivedTasks.map((archived) => ({
      archived,
      task: taskMap.get(archived.taskId) ?? null,
    }));
  }, [archivedTasks, tasks]);

  const isLoading = isLoadingArchived || isLoadingTasks;

  const invalidateArchiveQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpcReact.archive.pathFilter()),
      queryClient.refetchQueries({ queryKey: ["tasks"] }),
    ]);
  };

  const handleUnarchive = async (taskId: string) => {
    const item = items.find((i) => i.archived.taskId === taskId);
    const task = item?.task;

    try {
      await trpcClient.archive.unarchive.mutate({ taskId });
      await queryClient.invalidateQueries(
        trpcReact.workspace.getAll.pathFilter(),
      );
      await invalidateArchiveQueries();
      toast.success("Task unarchived", {
        action: task
          ? {
              label: "View task",
              onClick: () => void openTask(task),
            }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = message.match(BRANCH_NOT_FOUND_PATTERN);
      if (match) {
        setBranchNotFound({ taskId, branchName: match[1] });
      } else {
        toast.error(`Failed to unarchive task: ${message}`);
      }
    }
  };

  const executeDelete = async (taskId: string) => {
    try {
      await trpcClient.archive.delete.mutate({ taskId });
      await invalidateArchiveQueries();
      toast.success("Task deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to delete task: ${message}`);
    }
  };

  const handleContextMenu = async (
    item: ArchivedTaskWithDetails,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const taskTitle = item.task?.title ?? "Unknown task";

    try {
      const result =
        await trpcClient.contextMenu.showArchivedTaskContextMenu.mutate({
          taskTitle,
        });

      if (!result.action) return;

      switch (result.action.type) {
        case "restore":
          await handleUnarchive(item.archived.taskId);
          break;
        case "delete":
          await executeDelete(item.archived.taskId);
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Context menu error: ${message}`);
    }
  };

  const handleRecreateBranch = async () => {
    if (!branchNotFound) return;
    const { taskId } = branchNotFound;
    const item = items.find((i) => i.archived.taskId === taskId);
    const task = item?.task;
    setBranchNotFound(null);
    try {
      await trpcClient.archive.unarchive.mutate({
        taskId,
        recreateBranch: true,
      });
      await queryClient.invalidateQueries(
        trpcReact.workspace.getAll.pathFilter(),
      );
      await invalidateArchiveQueries();
      toast.success("Task unarchived", {
        action: task
          ? {
              label: "View task",
              onClick: () => void openTask(task),
            }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to unarchive task: ${message}`);
    }
  };

  return (
    <ArchivedTasksViewPresentation
      items={items}
      isLoading={isLoading}
      branchNotFound={branchNotFound}
      onUnarchive={handleUnarchive}
      onDelete={executeDelete}
      onContextMenu={handleContextMenu}
      onBranchNotFoundClose={() => setBranchNotFound(null)}
      onRecreateBranch={handleRecreateBranch}
    />
  );
}
