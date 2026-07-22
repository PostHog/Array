import {
  CaretDown,
  CaretRight,
  Lightbulb,
  List,
  MagnifyingGlass,
  Plus,
  SquaresFour,
} from "@phosphor-icons/react";
import { analyzeSkills } from "@posthog/core/skills/analyzeSkills";
import { Tabs, TabsList, TabsTrigger } from "@posthog/quill";
import type { SkillInfo, SkillSource } from "@posthog/shared";
import {
  Box,
  Button,
  Flex,
  ScrollArea,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ResizableSidebar } from "../../primitives/ResizableSidebar";
import { toast } from "../../primitives/toast";
import { MarketplaceBrowse } from "./MarketplaceBrowse";
import { SkillCardList, SkillSection, SOURCE_CONFIG } from "./SkillCard";
import { SkillDetailPanel } from "./SkillDetailPanel";
import { isSkillExistsError, skillErrorDescription } from "./skillErrors";
import {
  useRequestedSkillName,
  useSkillsSelectionActions,
} from "./skillsSelectionStore";
import { useSkillsSidebarStore } from "./skillsSidebarStore";
import { useSkillsViewStore } from "./skillsViewStore";
import { TeamSkillsTab } from "./TeamSkillsTab";
import { useCreateSkill } from "./useSkillMutations";
import { useSkills } from "./useSkills";
import { useSkillsWatcher } from "./useSkillsWatcher";
import { useTeamSkills } from "./useTeamSkills";

function getSkillCategory(name: string): string {
  const word = name.split("-")[0] ?? "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function groupByCategory(skills: SkillInfo[]): [string, SkillInfo[]][] {
  const map = new Map<string, SkillInfo[]>();
  for (const skill of skills) {
    const cat = getSkillCategory(skill.name);
    const existing = map.get(cat);
    if (existing) {
      existing.push(skill);
    } else {
      map.set(cat, [skill]);
    }
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const SOURCE_ORDER: SkillSource[] = [
  "user",
  "marketplace",
  "repo",
  "codex",
  "bundled",
];

// Installed = on disk, usable by agents right now. Team and Marketplace are
// remote catalogs; installing materializes a skill into Installed.
type SkillsTab = "installed" | "team" | "marketplace";

export function SkillsView() {
  const { data: skills = [], isLoading } = useSkills();
  useSkillsWatcher();

  const [tab, setTab] = useState<SkillsTab>("installed");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [scrollToPath, setScrollToPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [justCreatedPath, setJustCreatedPath] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const createSkill = useCreateSkill();

  const { data: teamListing } = useTeamSkills(skills);
  const teamAvailable = teamListing?.available ?? false;
  // Team access revoked mid-session: fall back to Installed.
  const activeTab: SkillsTab =
    tab === "team" && !teamAvailable ? "installed" : tab;

  const {
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    isResizing,
    setIsResizing,
  } = useSkillsSidebarStore();

  const { viewMode, setViewMode } = useSkillsViewStore();

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleCategory = useCallback((key: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectedSkill = useMemo(() => {
    if (selectedPath === null || skills.length === 0) return null;
    return skills.find((s) => s.path === selectedPath) ?? null;
  }, [skills, selectedPath]);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath((prev) => (prev === path ? null : path));
    setJustCreatedPath(null);
  }, []);

  const handleNewSkill = useCallback(async () => {
    setIsCreating(true);
    try {
      let name = "new-skill";
      for (let i = 2; i <= 21; i++) {
        try {
          const result = await createSkill.mutateAsync({ scope: "user", name });
          setSelectedPath(result.path);
          setJustCreatedPath(result.path);
          setScrollToPath(result.path);
          return;
        } catch (err) {
          if (isSkillExistsError(err) && i < 21) {
            name = `new-skill-${i}`;
          } else {
            throw err;
          }
        }
      }
    } catch (error) {
      toast.error("Failed to create skill", {
        description: skillErrorDescription(error),
      });
    } finally {
      setIsCreating(false);
    }
  }, [createSkill]);

  // Another surface (e.g. the scout helper links) can ask to open a specific
  // skill by name; honor it once the skill list has loaded, then clear it.
  const requestedSkillName = useRequestedSkillName();
  const { clearRequestedSkill } = useSkillsSelectionActions();
  useEffect(() => {
    if (!requestedSkillName || skills.length === 0) return;
    const match = skills.find((s) => s.name === requestedSkillName);
    if (match) {
      setSelectedPath(match.path);
      setScrollToPath(match.path);
    }
    clearRequestedSkill();
  }, [requestedSkillName, skills, clearRequestedSkill]);

  const handleScrolledIntoView = useCallback(() => setScrollToPath(null), []);

  const handleCloseSidebar = useCallback(() => {
    setSelectedPath(null);
    setJustCreatedPath(null);
  }, []);

  const analysis = useMemo(() => analyzeSkills(skills), [skills]);

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

  const allCollapsibleKeys = useMemo(() => {
    const keys: string[] = [];
    for (const source of SOURCE_ORDER) {
      const items = grouped.get(source);
      if (!items || items.length === 0) continue;
      keys.push(`source:${source}`);
      if (source === "bundled" || source === "codex") {
        for (const [cat] of groupByCategory(items)) {
          keys.push(`${source}:${cat}`);
        }
      }
    }
    return keys;
  }, [grouped]);

  const allCollapsed =
    allCollapsibleKeys.length > 0 &&
    allCollapsibleKeys.every((k) => collapsedCategories.has(k));

  const expandAll = useCallback(() => setCollapsedCategories(new Set()), []);
  const collapseAll = useCallback(
    () => setCollapsedCategories(new Set(allCollapsibleKeys)),
    [allCollapsibleKeys],
  );

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Box px="4" className="shrink-0 border-b border-b-(--gray-5)">
        <Tabs
          value={activeTab}
          onValueChange={(value: string) => setTab(value as SkillsTab)}
        >
          <TabsList variant="line" className="h-auto gap-0.5">
            <TabsTrigger value="installed" className="gap-1.5 px-2.5 py-2">
              <span className="font-medium text-[13px]">Installed</span>
            </TabsTrigger>
            {teamAvailable && (
              <TabsTrigger value="team" className="gap-1.5 px-2.5 py-2">
                <span className="font-medium text-[13px]">Team</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="marketplace" className="gap-1.5 px-2.5 py-2">
              <span className="font-medium text-[13px]">Marketplace</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Box>

      {activeTab === "marketplace" ? (
        <MarketplaceBrowse />
      ) : activeTab === "team" ? (
        <TeamSkillsTab skills={teamListing?.skills ?? []} />
      ) : (
        <Flex className="min-h-0 flex-1">
          <Box flexGrow="1" className="min-w-0">
            <ScrollArea
              type="auto"
              className="scroll-area-constrain-width h-full"
            >
              <Box px="4" py="3">
                <Flex pb="2" gap="2" align="center">
                  <Box flexGrow="1">
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
                  <Button
                    size="2"
                    variant="soft"
                    onClick={() => void handleNewSkill()}
                    disabled={isCreating}
                  >
                    {isCreating ? <Spinner size="1" /> : <Plus size={14} />}
                    New skill
                  </Button>
                </Flex>
                <Flex pb="3" gap="3" align="center">
                  <Tooltip
                    content={
                      viewMode === "list"
                        ? "Switch to grid view"
                        : "Switch to list view"
                    }
                    side="bottom"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setViewMode(viewMode === "list" ? "grid" : "list")
                      }
                      className="flex items-center gap-1 rounded p-1 text-[11px] text-gray-10 hover:bg-gray-3 hover:text-gray-12"
                    >
                      {viewMode === "list" ? (
                        <SquaresFour size={13} />
                      ) : (
                        <List size={13} />
                      )}
                      <span>{viewMode === "list" ? "Grid" : "List"}</span>
                    </button>
                  </Tooltip>
                  <div className="h-3 w-px bg-gray-5" />
                  <button
                    type="button"
                    onClick={allCollapsed ? expandAll : collapseAll}
                    className="text-[11px] text-gray-10 hover:text-gray-12"
                  >
                    {allCollapsed ? "Expand all" : "Collapse all"}
                  </button>
                </Flex>
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

                      if (source === "bundled" || source === "codex") {
                        const categories = groupByCategory(items);
                        const sourceKey = `source:${source}`;
                        const sourceCollapsed =
                          collapsedCategories.has(sourceKey);
                        return (
                          <Flex key={source} direction="column" gap="4">
                            <button
                              type="button"
                              onClick={() => toggleCategory(sourceKey)}
                              className="flex items-center gap-1.5 text-left text-gray-9 hover:text-gray-11"
                            >
                              {sourceCollapsed ? (
                                <CaretRight size={11} className="shrink-0" />
                              ) : (
                                <CaretDown size={11} className="shrink-0" />
                              )}
                              <span className="font-medium text-[12px] uppercase tracking-wider">
                                {config.sectionTitle}
                              </span>
                              <span className="text-[11px] text-gray-7">
                                {items.length}
                              </span>
                            </button>
                            {!sourceCollapsed &&
                              categories.map(([category, categorySkills]) => {
                                const catKey = `${source}:${category}`;
                                const collapsed =
                                  collapsedCategories.has(catKey);
                                return (
                                  <Flex
                                    key={category}
                                    direction="column"
                                    gap="1"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleCategory(catKey)}
                                      className="mb-0.5 flex items-center gap-1.5 text-left text-gray-9 hover:text-gray-11"
                                    >
                                      {collapsed ? (
                                        <CaretRight
                                          size={11}
                                          className="shrink-0"
                                        />
                                      ) : (
                                        <CaretDown
                                          size={11}
                                          className="shrink-0"
                                        />
                                      )}
                                      <span className="font-medium text-[12px]">
                                        {category}
                                      </span>
                                      <span className="text-[11px] text-gray-7">
                                        {categorySkills.length}
                                      </span>
                                    </button>
                                    {!collapsed && (
                                      <SkillCardList
                                        skills={categorySkills}
                                        selectedPath={
                                          selectedSkill?.path ?? null
                                        }
                                        onSelect={handleSelect}
                                        scrollToPath={scrollToPath}
                                        onScrolledIntoView={
                                          handleScrolledIntoView
                                        }
                                        analysis={analysis}
                                        viewMode={viewMode}
                                      />
                                    )}
                                  </Flex>
                                );
                              })}
                          </Flex>
                        );
                      }

                      return (
                        <SkillSection
                          key={source}
                          title={config.sectionTitle}
                          skills={items}
                          selectedPath={selectedSkill?.path ?? null}
                          onSelect={handleSelect}
                          scrollToPath={scrollToPath}
                          onScrolledIntoView={handleScrolledIntoView}
                          analysis={analysis}
                          viewMode={viewMode}
                          isCollapsed={collapsedCategories.has(
                            `source:${source}`,
                          )}
                          onToggle={() => toggleCategory(`source:${source}`)}
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
                key={selectedSkill.path}
                skill={selectedSkill}
                issues={analysis[selectedSkill.path] ?? []}
                canPublish={!!teamListing?.available}
                onClose={handleCloseSidebar}
                initialEditing={selectedSkill.path === justCreatedPath}
              />
            )}
          </ResizableSidebar>
        </Flex>
      )}
    </Flex>
  );
}
