import { Folder, Package, Storefront, User } from "@phosphor-icons/react";
import type { SkillInfo, SkillSource } from "@posthog/shared";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";

export const SOURCE_CONFIG: Record<
  SkillSource,
  { icon: typeof Package; label: string; sectionTitle: string }
> = {
  user: { icon: User, label: "User", sectionTitle: "Your skills" },
  bundled: {
    icon: Package,
    label: "PostHog Code",
    sectionTitle: "PostHog Code",
  },
  repo: { icon: Folder, label: "Repo", sectionTitle: "Repository" },
  marketplace: {
    icon: Storefront,
    label: "Marketplace",
    sectionTitle: "Marketplace",
  },
};

interface SkillCardProps {
  skill: SkillInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function SkillCard({ skill, isSelected, onClick }: SkillCardProps) {
  const config = SOURCE_CONFIG[skill.source];
  const Icon = config?.icon ?? Package;

  return (
    <Flex
      align="center"
      gap="2"
      px="3"
      py="2"
      className={`cursor-pointer rounded-lg border transition-colors ${
        isSelected
          ? "border-accent-8 bg-accent-3"
          : "border-gray-6 bg-gray-2 hover:border-gray-8 hover:bg-gray-3"
      }`}
      onClick={onClick}
    >
      <Box className="flex shrink-0 items-center justify-center rounded bg-gray-4 p-1.5">
        <Icon size={14} weight="duotone" className="text-gray-11" />
      </Box>

      <Flex direction="column" gap="0" className="min-w-0 flex-1">
        <Text className="truncate font-medium text-[13px] text-gray-12">
          {skill.name}
        </Text>
        {skill.description && (
          <Text className="truncate text-[12px] text-gray-10">
            {skill.description}
          </Text>
        )}
      </Flex>

      {skill.repoName && (
        <Badge size="1" variant="soft" color="gray" className="shrink-0">
          {skill.repoName}
        </Badge>
      )}
    </Flex>
  );
}

interface SkillSectionProps {
  title: string;
  skills: SkillInfo[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function SkillSection({
  title,
  skills,
  selectedPath,
  onSelect,
}: SkillSectionProps) {
  return (
    <Flex direction="column" gap="1">
      <Text className="mb-1 font-medium text-[12px] text-gray-9 uppercase tracking-wider">
        {title}
      </Text>
      <Flex direction="column" gap="1">
        {skills.map((skill) => (
          <SkillCard
            key={skill.path}
            skill={skill}
            isSelected={selectedPath === skill.path}
            onClick={() => onSelect(skill.path)}
          />
        ))}
      </Flex>
    </Flex>
  );
}
