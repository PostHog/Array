import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { ScoutSurface } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { track } from "@posthog/ui/shell/analytics";
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
export function ScoutHelperSkillLinks({ surface }: { surface: ScoutSurface }) {
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
            onClick={() =>
              track(ANALYTICS_EVENTS.SCOUT_ACTION, {
                action_type: "open_helper_skill",
                surface,
                helper_skill: skill.label,
              })
            }
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
