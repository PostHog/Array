import { Lightbulb, X } from "@phosphor-icons/react";
import type { AlwaysOnSkillRef } from "@posthog/shared";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useSkillsSelectionActions } from "@posthog/ui/features/skills/skillsSelectionStore";
import { Tooltip } from "@radix-ui/themes";
import { useCallback, useState } from "react";

export function useAlwaysOnSkillSelection() {
  const alwaysOnSkills = useSettingsStore((state) => state.alwaysOnSkills);
  const [excludedKeys, setExcludedKeys] = useState(() => new Set<string>());
  const includedSkills = alwaysOnSkills.filter(
    (skill) => !excludedKeys.has(`${skill.source}:${skill.path}`),
  );
  const exclude = useCallback((skill: AlwaysOnSkillRef) => {
    setExcludedKeys((current) => {
      const next = new Set(current);
      next.add(`${skill.source}:${skill.path}`);
      return next;
    });
  }, []);
  const reset = useCallback(() => setExcludedKeys(new Set()), []);

  return { includedSkills, excludedKeys, exclude, reset };
}

export function AlwaysOnSkillChips({
  skills,
  onExclude,
}: {
  skills: AlwaysOnSkillRef[];
  onExclude: (skill: AlwaysOnSkillRef) => void;
}) {
  const { requestSkill } = useSkillsSelectionActions();
  const openSkill = useCallback(
    (name: string) => {
      requestSkill(name);
      openSettings("skills");
    },
    [requestSkill],
  );

  return skills.map((skill) => (
    <span
      key={`${skill.source}:${skill.path}`}
      className="inline-flex items-center gap-1 rounded-[var(--radius-1)] bg-[var(--gray-a3)] px-1.5 py-px font-medium text-[var(--gray-11)]"
    >
      <Tooltip content={`View ${skill.name}`}>
        <button
          type="button"
          onClick={() => openSkill(skill.name)}
          className="inline-flex min-w-0 items-center gap-1 rounded text-[var(--gray-11)] hover:text-gray-12"
        >
          <Lightbulb size={12} />
          <span className="truncate">{skill.name}</span>
        </button>
      </Tooltip>
      <Tooltip content={`Don't include ${skill.name} in this task`}>
        <button
          type="button"
          onClick={() => onExclude(skill)}
          aria-label={`Remove ${skill.name} from this task`}
          className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded text-gray-10 hover:bg-gray-5 hover:text-gray-12"
        >
          <X size={12} />
        </button>
      </Tooltip>
    </span>
  ));
}
