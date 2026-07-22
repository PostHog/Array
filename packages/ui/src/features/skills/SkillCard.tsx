import {
  CaretDown,
  CaretRight,
  Folder,
  Package,
  Robot,
  Storefront,
  User,
  Warning,
} from "@phosphor-icons/react";
import type {
  SkillAnalysis,
  SkillIssue,
} from "@posthog/core/skills/analyzeSkills";
import type { SkillInfo, SkillSource } from "@posthog/shared";
import { Badge, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useEffect, useRef } from "react";
import { SkillListCard } from "./SkillListCard";
import type { SkillViewMode } from "./skillsViewStore";

export function humanizeName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const SOURCE_CONFIG: Record<
  SkillSource,
  { icon: typeof Package; label: string; sectionTitle: string }
> = {
  user: { icon: User, label: "User", sectionTitle: "Your skills" },
  bundled: {
    icon: Package,
    label: "PostHog",
    sectionTitle: "PostHog",
  },
  repo: { icon: Folder, label: "Repo", sectionTitle: "Repository" },
  marketplace: {
    icon: Storefront,
    label: "Marketplace",
    sectionTitle: "Marketplace",
  },
  codex: { icon: Robot, label: "Codex", sectionTitle: "Codex" },
};

interface SkillCardProps {
  skill: SkillInfo;
  isSelected: boolean;
  onClick: () => void;
  /** When true, scroll this card into view once (used for deep-linked skills). */
  scrollIntoView?: boolean;
  onScrolledIntoView?: () => void;
  issues?: SkillIssue[];
}

export function SkillCard({
  skill,
  isSelected,
  onClick,
  scrollIntoView,
  onScrolledIntoView,
  issues = [],
}: SkillCardProps) {
  const config = SOURCE_CONFIG[skill.source];
  const Icon = config?.icon ?? Package;

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollIntoView) return;
    ref.current?.scrollIntoView({ block: "center" });
    onScrolledIntoView?.();
  }, [scrollIntoView, onScrolledIntoView]);

  return (
    <SkillListCard
      cardRef={ref}
      icon={<Icon size={14} weight="duotone" className="text-gray-11" />}
      title={humanizeName(skill.name)}
      subtitle={skill.description || undefined}
      isSelected={isSelected}
      onClick={onClick}
      trailing={
        <>
          {issues.length > 0 && (
            <Tooltip
              content={
                <Flex direction="column" gap="1">
                  {issues.map((issue) => (
                    <Text key={issue.message} size="1">
                      {issue.message}
                    </Text>
                  ))}
                </Flex>
              }
            >
              <Warning size={14} className="shrink-0 text-amber-11" />
            </Tooltip>
          )}
          {skill.repoName && (
            <Badge size="1" variant="soft" color="gray" className="shrink-0">
              {skill.repoName}
            </Badge>
          )}
        </>
      }
    />
  );
}

export function SkillGridCard({
  skill,
  isSelected,
  onClick,
  scrollIntoView,
  onScrolledIntoView,
  issues = [],
}: SkillCardProps) {
  const config = SOURCE_CONFIG[skill.source];
  const Icon = config?.icon ?? Package;

  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!scrollIntoView) return;
    ref.current?.scrollIntoView({ block: "center" });
    onScrolledIntoView?.();
  }, [scrollIntoView, onScrolledIntoView]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors ${
        isSelected
          ? "border-accent-8 bg-accent-3"
          : "border-gray-6 bg-gray-2 hover:border-gray-8 hover:bg-gray-3"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center justify-center rounded bg-gray-4 p-1.5">
          <Icon size={16} weight="duotone" className="text-gray-11" />
        </div>
        {issues.length > 0 && (
          <Warning size={12} className="shrink-0 text-amber-11" />
        )}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 font-medium text-[12px] text-gray-12 leading-tight">
          {humanizeName(skill.name)}
        </p>
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-9 leading-tight">
            {skill.description}
          </p>
        )}
      </div>
    </button>
  );
}

interface SkillCardListProps {
  skills: SkillInfo[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  scrollToPath: string | null;
  onScrolledIntoView: () => void;
  analysis?: SkillAnalysis;
  viewMode?: SkillViewMode;
}

export function SkillCardList({
  skills,
  selectedPath,
  onSelect,
  scrollToPath,
  onScrolledIntoView,
  analysis,
  viewMode = "list",
}: SkillCardListProps) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {skills.map((skill) => (
          <SkillGridCard
            key={skill.path}
            skill={skill}
            isSelected={selectedPath === skill.path}
            onClick={() => onSelect(skill.path)}
            scrollIntoView={scrollToPath === skill.path}
            onScrolledIntoView={onScrolledIntoView}
            issues={analysis?.[skill.path]}
          />
        ))}
      </div>
    );
  }
  return (
    <Flex direction="column" gap="1">
      {skills.map((skill) => (
        <SkillCard
          key={skill.path}
          skill={skill}
          isSelected={selectedPath === skill.path}
          onClick={() => onSelect(skill.path)}
          scrollIntoView={scrollToPath === skill.path}
          onScrolledIntoView={onScrolledIntoView}
          issues={analysis?.[skill.path]}
        />
      ))}
    </Flex>
  );
}

interface SkillSectionProps {
  title: string;
  skills: SkillInfo[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  scrollToPath: string | null;
  onScrolledIntoView: () => void;
  analysis?: SkillAnalysis;
  viewMode?: SkillViewMode;
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function SkillSection({
  title,
  skills,
  selectedPath,
  onSelect,
  scrollToPath,
  onScrolledIntoView,
  analysis,
  viewMode = "list",
  isCollapsed = false,
  onToggle,
}: SkillSectionProps) {
  return (
    <Flex direction="column" gap="1">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="mb-1 flex items-center gap-1.5 text-left text-gray-9 hover:text-gray-11"
        >
          {isCollapsed ? (
            <CaretRight size={11} className="shrink-0" />
          ) : (
            <CaretDown size={11} className="shrink-0" />
          )}
          <span className="font-medium text-[12px] uppercase tracking-wider">
            {title}
          </span>
          <span className="text-[11px] text-gray-7">{skills.length}</span>
        </button>
      ) : (
        <Text className="mb-1 font-medium text-[12px] text-gray-9 uppercase tracking-wider">
          {title}
        </Text>
      )}
      {!isCollapsed && (
        <SkillCardList
          skills={skills}
          selectedPath={selectedPath}
          onSelect={onSelect}
          scrollToPath={scrollToPath}
          onScrolledIntoView={onScrolledIntoView}
          analysis={analysis}
          viewMode={viewMode}
        />
      )}
    </Flex>
  );
}
