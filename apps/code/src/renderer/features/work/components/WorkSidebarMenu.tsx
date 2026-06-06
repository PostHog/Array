import {
  BookOpen,
  Brain,
  FolderSimple,
  type IconProps,
  Plugs,
} from "@phosphor-icons/react";
import { ScrollArea } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import { useNavigationStore, type WorkView } from "@stores/navigationStore";
import { type ComponentType, useMemo } from "react";
import { NewTaskItem } from "../../sidebar/components/items/HomeItem";
import { SidebarItem } from "../../sidebar/components/SidebarItem";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { useWorkProjects } from "../canvas/useProjectCanvas";

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

export function WorkSidebarMenu() {
  const workView = useNavigationStore((s) => s.workView);
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
        </Flex>
      </ScrollArea>
    </Box>
  );
}
