import { UsersThree } from "@phosphor-icons/react";
import type { TeamSkillInfo } from "@posthog/core/skills/teamSkillsService";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";

interface TeamSkillsSectionProps {
  skills: TeamSkillInfo[];
  selectedName: string | null;
  onSelect: (skill: TeamSkillInfo) => void;
}

/** Skill cards shared via PostHog cloud, read-only here. */
export function TeamSkillsSection({
  skills,
  selectedName,
  onSelect,
}: TeamSkillsSectionProps) {
  return (
    <Flex direction="column" gap="1">
      {skills.map((skill) => (
        <Flex
          key={skill.id}
          align="center"
          gap="2"
          px="3"
          py="2"
          className={`cursor-pointer rounded-lg border transition-colors ${
            selectedName === skill.name
              ? "border-accent-8 bg-accent-3"
              : "border-gray-6 bg-gray-2 hover:border-gray-8 hover:bg-gray-3"
          }`}
          onClick={() => onSelect(skill)}
        >
          <Box className="flex shrink-0 items-center justify-center rounded bg-gray-4 p-1.5">
            <UsersThree size={14} weight="duotone" className="text-gray-11" />
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
          {skill.installedLocally && (
            <Badge size="1" variant="soft" color="green" className="shrink-0">
              Installed
            </Badge>
          )}
          <Badge size="1" variant="soft" color="gray" className="shrink-0">
            v{skill.version}
          </Badge>
        </Flex>
      ))}
    </Flex>
  );
}
