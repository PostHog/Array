import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Text } from "@radix-ui/themes";

const HELPER_SKILLS = [
  {
    label: "authoring scouts",
    href: "https://github.com/PostHog/ai-plugin/tree/main/skills/authoring-signals-scouts",
  },
  {
    label: "exploring scouts",
    href: "https://github.com/PostHog/ai-plugin/tree/main/skills/exploring-signals-scouts",
  },
];

/** One-line pointer to the two official scout helper skills on GitHub. */
export function ScoutHelperSkillLinks() {
  return (
    <Text className="text-[12px] text-gray-10">
      Helper skills:{" "}
      {HELPER_SKILLS.map((skill, index) => (
        <span key={skill.href}>
          {index > 0 ? " · " : null}
          <a
            href={skill.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-accent-11 no-underline hover:text-accent-12"
          >
            {skill.label}
            <ArrowSquareOutIcon size={11} />
          </a>
        </span>
      ))}
    </Text>
  );
}
