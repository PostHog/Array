import { Lightbulb, Warning, X } from "@phosphor-icons/react";
import {
  type AlwaysOnSkillRef,
  type AlwaysOnSkillTarget,
  getApplicableAlwaysOnSkills,
  type SkillInfo,
} from "@posthog/shared";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useSkillsSelectionActions } from "@posthog/ui/features/skills/skillsSelectionStore";
import { Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useAlwaysOnSkillSelection({
  discoveredSkills,
  target,
  draftKey,
}: {
  discoveredSkills: SkillInfo[] | undefined;
  target: AlwaysOnSkillTarget;
  draftKey: string;
}) {
  const alwaysOnSkills = useSettingsStore((state) => state.alwaysOnSkills);
  const [excludedKeys, setExcludedKeys] = useState(() => new Set<string>());
  const { applicable: includedSkills, unavailable } = useMemo(
    () =>
      getApplicableAlwaysOnSkills(
        alwaysOnSkills,
        discoveredSkills,
        target,
        excludedKeys,
      ),
    [alwaysOnSkills, discoveredSkills, target, excludedKeys],
  );
  const exclude = useCallback((skill: AlwaysOnSkillRef) => {
    setExcludedKeys((current) => {
      const next = new Set(current);
      next.add(`${skill.source}:${skill.path}`);
      return next;
    });
  }, []);
  const reset = useCallback(() => setExcludedKeys(new Set()), []);
  const previousDraftKey = useRef(draftKey);
  useEffect(() => {
    if (previousDraftKey.current === draftKey) return;
    previousDraftKey.current = draftKey;
    reset();
  }, [draftKey, reset]);

  return { includedSkills, unavailable, excludedKeys, exclude, reset };
}

export function AlwaysOnSkillChips({
  skills,
  onExclude,
  disabled = false,
}: {
  skills: AlwaysOnSkillRef[];
  onExclude: (skill: AlwaysOnSkillRef) => void;
  disabled?: boolean;
}) {
  const { requestSkill } = useSkillsSelectionActions();
  const openSkill = useCallback(
    (skill: AlwaysOnSkillRef) => {
      requestSkill({ source: skill.source, path: skill.path });
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
          onClick={() => openSkill(skill)}
          disabled={disabled}
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
          disabled={disabled}
          aria-label={`Remove ${skill.name} from this task`}
          className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded text-gray-10 hover:bg-gray-5 hover:text-gray-12"
        >
          <X size={12} />
        </button>
      </Tooltip>
    </span>
  ));
}

export function UnavailableAlwaysOnSkills({
  skills,
}: {
  skills: AlwaysOnSkillRef[];
}) {
  if (skills.length === 0) return null;
  const names = skills.map((skill) => skill.name).join(", ");
  return (
    <Tooltip content={`Couldn't find: ${names}`}>
      <span className="inline-flex items-center gap-1 rounded-[var(--radius-1)] bg-[var(--amber-a3)] px-1.5 py-px font-medium text-[var(--amber-11)]">
        <Warning size={12} />
        {skills.length === 1
          ? `${skills[0].name} unavailable`
          : `${skills.length} skills unavailable`}
      </span>
    </Tooltip>
  );
}
