import { Tooltip } from "@components/ui/Tooltip";
import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { usePinnedTasks } from "@features/sidebar/hooks/usePinnedTasks";
import { useArchiveTask } from "@features/tasks/hooks/useArchiveTask";
import {
  Archive,
  BookOpen,
  Brain,
  DotsThree,
  FolderSimple,
  type IconProps,
  Plugs,
  PushPin,
} from "@phosphor-icons/react";
import { ScrollArea } from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useTaskContextMenu } from "@renderer/hooks/useTaskContextMenu";
import type { Task } from "@shared/types";
import { useNavigationStore, type WorkView } from "@stores/navigationStore";
import { type ComponentType, useMemo, useState } from "react";
import { NewTaskItem } from "../../sidebar/components/items/HomeItem";
import { SidebarItem } from "../../sidebar/components/SidebarItem";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { useWorkProjects } from "../canvas/useProjectCanvas";
import { useWorkThreadTasks } from "../hooks/useWorkThreadTasks";

interface WorkSidebarItemSpec {
  icon: ComponentType<IconProps>;
  label: string;
  /** When set, the item navigates to that workView and lights up while active. */
  workView?: WorkView;
}

const STATIC_ITEMS: WorkSidebarItemSpec[] = [
  { icon: FolderSimple, label: "Projects" },
  { icon: BookOpen, label: "Skills", workView: "library" },
  { icon: Plugs, label: "Data sources" },
  { icon: Brain, label: "Memory", workView: "memory" },
];

const THREADS_COLLAPSED_COUNT = 5;

function deriveThreadLabel(task: Task): string {
  const title = task.title?.trim();
  if (title) return title;
  const firstLine = task.description?.split(/\r?\n/)[0]?.trim();
  if (firstLine) return firstLine.slice(0, 80);
  return "Untitled task";
}

function ThreadHoverToolbar({
  isPinned,
  onTogglePin,
  onArchive,
}: {
  isPinned: boolean;
  onTogglePin: () => void;
  onArchive: () => void;
}) {
  return (
    <span className="peer-hover/collabs:!hidden hidden shrink-0 items-center gap-0.5 group-hover:flex">
      <Tooltip content={isPinned ? "Unpin thread" : "Pin thread"} side="top">
        {/* biome-ignore lint/a11y/useSemanticElements: nested button not allowed inside SidebarItem button */}
        <span
          role="button"
          tabIndex={0}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin();
            }
          }}
        >
          <PushPin size={12} weight={isPinned ? "fill" : "regular"} />
        </span>
      </Tooltip>
      <Tooltip content="Archive thread" side="top">
        {/* biome-ignore lint/a11y/useSemanticElements: nested button not allowed inside SidebarItem button */}
        <span
          role="button"
          tabIndex={0}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onArchive();
            }
          }}
        >
          <Archive size={12} />
        </span>
      </Tooltip>
    </span>
  );
}

export function WorkSidebarMenu() {
  const workView = useNavigationStore((s) => s.workView);
  const activeTaskId = useNavigationStore((s) => s.workActiveTaskId);
  const navigateToWorkHome = useNavigationStore((s) => s.navigateToWorkHome);
  const navigateToWorkLibrary = useNavigationStore(
    (s) => s.navigateToWorkLibrary,
  );
  const navigateToWorkDataSources = useNavigationStore(
    (s) => s.navigateToWorkDataSources,
  );
  const navigateToWorkProjects = useNavigationStore(
    (s) => s.navigateToWorkProjects,
  );
  const navigateToWorkMemory = useNavigationStore(
    (s) => s.navigateToWorkMemory,
  );
  const navigateToWorkTask = useNavigationStore((s) => s.navigateToWorkTask);
  const navigateToWorkProjectDetail = useNavigationStore(
    (s) => s.navigateToWorkProjectDetail,
  );
  const workSelectedProjectId = useNavigationStore(
    (s) => s.workSelectedProjectId,
  );
  const isProjectDetailActive = workView === "project-detail";

  const { data: allProjects } = useWorkProjects();
  const pinnedProjects = useMemo(() => {
    const arr = (allProjects ?? []).filter((p) => p.pinnedAt);
    arr.sort(
      (a, b) =>
        new Date(b.pinnedAt ?? 0).getTime() -
        new Date(a.pinnedAt ?? 0).getTime(),
    );
    return arr.slice(0, 8);
  }, [allProjects]);

  const { data: threadTasks } = useWorkThreadTasks();
  const archivedTaskIds = useArchivedTaskIds();
  const { pinnedTaskIds, togglePin } = usePinnedTasks();
  const { archiveTask } = useArchiveTask();
  const { showContextMenu } = useTaskContextMenu();
  const [threadsExpanded, setThreadsExpanded] = useState(false);

  const isHomeActive = workView === "home";
  const isLibraryActive = workView === "library";
  const isDataSourcesActive = workView === "data-sources";
  // Keep the Projects nav item lit while a project is open – the open project
  // shows as a sub-item, so the parent remains the "active section".
  const isProjectsActive = workView === "projects" || isProjectDetailActive;
  const isMemoryActive = workView === "memory";

  const activeProject = useMemo(() => {
    if (!isProjectDetailActive || !workSelectedProjectId) return null;
    return (
      (allProjects ?? []).find((p) => p.id === workSelectedProjectId) ?? null
    );
  }, [isProjectDetailActive, workSelectedProjectId, allProjects]);
  const showActiveAsSubItem =
    !!activeProject && !pinnedProjects.some((p) => p.id === activeProject.id);

  const threadsWithTasks: { id: string; task: Task }[] = threadTasks
    .filter((task) => !archivedTaskIds.has(task.id))
    .sort((a, b) => {
      const aPinned = pinnedTaskIds.has(a.id) ? 1 : 0;
      const bPinned = pinnedTaskIds.has(b.id) ? 1 : 0;
      return bPinned - aPinned;
    })
    .map((task) => ({ id: task.id, task }));

  const hasOverflow = threadsWithTasks.length > THREADS_COLLAPSED_COUNT;
  const visibleThreads =
    threadsExpanded || !hasOverflow
      ? threadsWithTasks
      : threadsWithTasks.slice(0, THREADS_COLLAPSED_COUNT);
  const hiddenCount = threadsWithTasks.length - visibleThreads.length;

  return (
    <Box height="100%" position="relative">
      <ScrollArea className="h-full overflow-y-auto overflow-x-hidden">
        <Flex direction="column" py="2" px="2" gap="1px">
          <Box mb="2">
            <NewTaskItem
              isActive={isHomeActive}
              onClick={navigateToWorkHome}
              variant="primary"
            />
          </Box>

          {STATIC_ITEMS.map((item) => {
            const Icon = item.icon;
            const isDataSources = item.label === "Data sources";
            const isProjects = item.label === "Projects";
            const isMemory = item.workView === "memory";
            const isSkills = item.workView === "library";
            const isActive =
              (isDataSources && isDataSourcesActive) ||
              (isProjects && isProjectsActive) ||
              (isMemory && isMemoryActive) ||
              (isSkills && isLibraryActive);
            const onClick = isDataSources
              ? navigateToWorkDataSources
              : isProjects
                ? navigateToWorkProjects
                : isMemory
                  ? navigateToWorkMemory
                  : isSkills
                    ? navigateToWorkLibrary
                    : undefined;
            return (
              <Box key={item.label}>
                <SidebarItem
                  depth={0}
                  icon={
                    <Icon size={16} weight={isActive ? "fill" : "regular"} />
                  }
                  label={item.label}
                  isActive={isActive}
                  onClick={onClick}
                />
                {isProjects &&
                  (pinnedProjects.length > 0 || showActiveAsSubItem) && (
                    <Flex direction="column" gap="1px">
                      {pinnedProjects.map((project) => {
                        const ProjectIcon =
                          PROJECT_ICON_MAP[project.iconId] ??
                          PROJECT_ICON_MAP.lightbulb;
                        const isProjectActive =
                          isProjectDetailActive &&
                          workSelectedProjectId === project.id;
                        return (
                          <SidebarItem
                            key={project.id}
                            depth={1}
                            icon={
                              <ProjectIcon
                                size={14}
                                weight={isProjectActive ? "fill" : "regular"}
                              />
                            }
                            label={project.name}
                            isActive={isProjectActive}
                            onClick={() =>
                              navigateToWorkProjectDetail(project.id)
                            }
                          />
                        );
                      })}
                      {showActiveAsSubItem &&
                        activeProject &&
                        (() => {
                          const ProjectIcon =
                            PROJECT_ICON_MAP[activeProject.iconId] ??
                            PROJECT_ICON_MAP.lightbulb;
                          return (
                            <SidebarItem
                              key={activeProject.id}
                              depth={1}
                              icon={<ProjectIcon size={14} weight="fill" />}
                              label={activeProject.name}
                              isActive
                              onClick={() =>
                                navigateToWorkProjectDetail(activeProject.id)
                              }
                            />
                          );
                        })()}
                    </Flex>
                  )}
              </Box>
            );
          })}

          {threadsWithTasks.length > 0 && (
            <>
              <Box px="2" pt="3" pb="1">
                <Text
                  as="div"
                  className="font-medium text-(--gray-10) text-[11px] uppercase tracking-wide"
                >
                  Threads
                </Text>
              </Box>

              {visibleThreads.map(({ id, task }) => {
                const isActive =
                  workView === "task-detail" && activeTaskId === id;
                const isPinned = pinnedTaskIds.has(id);
                const leadingIcon = isPinned ? (
                  <PushPin size={16} weight="fill" className="text-accent-11" />
                ) : undefined;
                return (
                  <Box key={id}>
                    <SidebarItem
                      depth={0}
                      icon={leadingIcon}
                      label={deriveThreadLabel(task)}
                      isActive={isActive}
                      onClick={() => navigateToWorkTask(id)}
                      onContextMenu={(e) =>
                        showContextMenu(task, e, {
                          isPinned,
                          onTogglePin: () => void togglePin(id),
                        })
                      }
                      endContent={
                        <ThreadHoverToolbar
                          isPinned={isPinned}
                          onTogglePin={() => void togglePin(id)}
                          onArchive={() => void archiveTask({ taskId: id })}
                        />
                      }
                    />
                  </Box>
                );
              })}

              {hasOverflow && (
                <Box>
                  <SidebarItem
                    depth={0}
                    icon={<DotsThree size={16} weight="bold" />}
                    label={
                      threadsExpanded
                        ? "Show less"
                        : `Show more (${hiddenCount})`
                    }
                    isActive={false}
                    onClick={() => setThreadsExpanded((v) => !v)}
                  />
                </Box>
              )}
            </>
          )}
        </Flex>
      </ScrollArea>
    </Box>
  );
}
