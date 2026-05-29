import { Lightbulb, MagnifyingGlass } from "@phosphor-icons/react";
import type { SkillInfo, SkillSource } from "@posthog/shared";
import { Box, Flex, ScrollArea, Text, TextField } from "@radix-ui/themes";
import { useCallback, useMemo, useState } from "react";
import { useSetHeaderContent } from "../../hooks/useSetHeaderContent";
import { ResizableSidebar } from "../../primitives/ResizableSidebar";
import { SkillSection, SOURCE_CONFIG } from "./SkillCard";
import { SkillDetailPanel } from "./SkillDetailPanel";
import { useSkillsSidebarStore } from "./skillsSidebarStore";
import { useSkills } from "./useSkills";

const SOURCE_ORDER: SkillSource[] = ["user", "marketplace", "repo", "bundled"];

export function SkillsView() {
  const { data: skills = [], isLoading } = useSkills();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    isResizing,
    setIsResizing,
  } = useSkillsSidebarStore();

  const selectedSkill = useMemo(() => {
    if (selectedPath === null || skills.length === 0) return null;
    return skills.find((s) => s.path === selectedPath) ?? null;
  }, [skills, selectedPath]);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath((prev) => (prev === path ? null : path));
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSelectedPath(null);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<SkillSource, SkillInfo[]>();
    for (const source of SOURCE_ORDER) {
      map.set(source, []);
    }
    const query = searchQuery.trim().toLowerCase();
    for (const skill of skills) {
      if (
        query &&
        !skill.name.toLowerCase().includes(query) &&
        !(skill.description?.toLowerCase().includes(query) ?? false)
      ) {
        continue;
      }
      const list = map.get(skill.source);
      if (list) {
        list.push(skill);
      }
    }
    return map;
  }, [skills, searchQuery]);

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <Lightbulb size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Skills"
        >
          Skills
        </Text>
      </Flex>
    ),
    [],
  );

  useSetHeaderContent(headerContent);

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Flex className="min-h-0 flex-1">
        <Box flexGrow="1" className="min-w-0">
          <ScrollArea
            type="auto"
            className="scroll-area-constrain-width h-full"
          >
            <Box px="4" py="3">
              <Box pb="3">
                <TextField.Root
                  size="2"
                  placeholder="Search skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="text-[13px]"
                >
                  <TextField.Slot>
                    <MagnifyingGlass size={14} />
                  </TextField.Slot>
                </TextField.Root>
              </Box>
              {skills.length === 0 && !isLoading ? (
                <Flex
                  align="center"
                  justify="center"
                  direction="column"
                  gap="3"
                  className="py-12"
                >
                  <Box className="rounded-lg border border-gray-6 border-dashed p-4">
                    <Lightbulb size={24} className="text-gray-8" />
                  </Box>
                  <Text className="text-[13px] text-gray-10">
                    No skills found
                  </Text>
                </Flex>
              ) : (
                <Flex direction="column" gap="5">
                  {SOURCE_ORDER.map((source) => {
                    const items = grouped.get(source);
                    if (!items || items.length === 0) return null;
                    const config = SOURCE_CONFIG[source];

                    return (
                      <SkillSection
                        key={source}
                        title={config.sectionTitle}
                        skills={items}
                        selectedPath={selectedSkill?.path ?? null}
                        onSelect={handleSelect}
                      />
                    );
                  })}
                </Flex>
              )}
            </Box>
          </ScrollArea>
        </Box>

        <ResizableSidebar
          open={!!selectedSkill}
          width={sidebarWidth}
          setWidth={setSidebarWidth}
          isResizing={isResizing}
          setIsResizing={setIsResizing}
          side="right"
        >
          {selectedSkill && (
            <SkillDetailPanel
              skill={selectedSkill}
              onClose={handleCloseSidebar}
            />
          )}
        </ResizableSidebar>
      </Flex>
    </Flex>
  );
}
