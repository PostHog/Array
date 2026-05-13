import {
  BookOpen,
  Brain,
  ClockClockwise,
  FolderSimple,
  House,
  type IconProps,
  Lightbulb,
  Notebook,
  Plugs,
  Plus,
} from "@phosphor-icons/react";
import { ScrollArea } from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore, type WorkView } from "@stores/navigationStore";
import { useWorkSkillsStore } from "@stores/workSkillsStore";
import type { ComponentType } from "react";
import { NewTaskItem } from "../../sidebar/components/items/HomeItem";
import { SidebarItem } from "../../sidebar/components/SidebarItem";

interface WorkSidebarItemSpec {
  icon: ComponentType<IconProps>;
  label: string;
  /** When set, the item navigates to that workView and lights up while active. */
  workView?: WorkView | "scheduled-section";
}

const STATIC_ITEMS: WorkSidebarItemSpec[] = [
  { icon: FolderSimple, label: "Projects" },
  {
    icon: ClockClockwise,
    label: "Scheduled",
    workView: "scheduled-section",
  },
  { icon: Notebook, label: "Artifacts" },
  { icon: Plugs, label: "MCP" },
  { icon: Brain, label: "Memory" },
];

export function WorkSidebarMenu() {
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);
  const workView = useNavigationStore((s) => s.workView);
  const selectedSkillId = useNavigationStore((s) => s.workSelectedSkillId);
  const navigateToWorkHome = useNavigationStore((s) => s.navigateToWorkHome);
  const navigateToWorkGenerate = useNavigationStore(
    (s) => s.navigateToWorkGenerate,
  );
  const navigateToWorkSkill = useNavigationStore((s) => s.navigateToWorkSkill);
  const navigateToWorkLibrary = useNavigationStore(
    (s) => s.navigateToWorkLibrary,
  );
  const navigateToWorkScheduledList = useNavigationStore(
    (s) => s.navigateToWorkScheduledList,
  );
  const skills = useWorkSkillsStore((s) => s.skills);

  const handleNewTaskClick = () => {
    setMode("code");
    navigateToTaskInput();
  };

  const isHomeActive = workView === "home";
  const isGenerateActive = workView === "generate";
  const isLibraryActive = workView === "library";
  const isScheduledActive =
    workView === "scheduled-list" || workView === "scheduled-edit";

  return (
    <Box height="100%" position="relative">
      <ScrollArea className="h-full overflow-y-auto overflow-x-hidden">
        <Flex direction="column" py="2" px="2" gap="1px">
          <Box mb="2">
            <NewTaskItem
              isActive={false}
              onClick={handleNewTaskClick}
              variant="primary"
            />
          </Box>

          <Box>
            <SidebarItem
              depth={0}
              icon={
                <House size={16} weight={isHomeActive ? "fill" : "regular"} />
              }
              label="Home"
              isActive={isHomeActive}
              onClick={navigateToWorkHome}
            />
          </Box>

          {STATIC_ITEMS.map((item) => {
            const Icon = item.icon;
            const isScheduled = item.workView === "scheduled-section";
            const isActive = isScheduled && isScheduledActive;
            const onClick = isScheduled
              ? navigateToWorkScheduledList
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
              </Box>
            );
          })}

          <Box px="2" pt="3" pb="1">
            <Text
              as="div"
              className="font-medium text-(--gray-10) text-[11px] uppercase tracking-wide"
            >
              Skills
            </Text>
          </Box>

          <Box>
            <SidebarItem
              depth={0}
              icon={
                <BookOpen
                  size={16}
                  weight={isLibraryActive ? "fill" : "regular"}
                />
              }
              label="Library"
              isActive={isLibraryActive}
              onClick={navigateToWorkLibrary}
            />
          </Box>

          <Box>
            <SidebarItem
              depth={0}
              icon={<Plus size={16} weight="bold" />}
              label="New skill"
              isActive={isGenerateActive}
              onClick={navigateToWorkGenerate}
            />
          </Box>

          {skills.map((skill) => {
            const isSkillActive =
              selectedSkillId === skill.id && workView === "skill-detail";
            return (
              <Box key={skill.id}>
                <SidebarItem
                  depth={0}
                  icon={
                    <Lightbulb
                      size={16}
                      weight={isSkillActive ? "fill" : "regular"}
                    />
                  }
                  label={skill.name}
                  isActive={isSkillActive}
                  onClick={() => navigateToWorkSkill(skill.id)}
                />
              </Box>
            );
          })}
        </Flex>
      </ScrollArea>
    </Box>
  );
}
