import { ArrowSquareOutIcon, GearSixIcon } from "@phosphor-icons/react";
import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import {
  formatRunIntervalShort,
  prettifyScoutSkillName,
  type ScoutRollup,
  scoutSkillSlug,
} from "@posthog/core/scouts/scoutPresentation";
import { skillUrl } from "@posthog/ui/utils/posthogLinks";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ScoutConfigUpdate } from "../hooks/useScoutConfigMutations";
import {
  DryRunBadge,
  deriveScoutRowState,
  ScoutOriginBadge,
  ScoutStatusDot,
} from "./ScoutBadges";
import { ScoutConfigForm, ScoutEnabledSwitch } from "./ScoutConfigControls";
import { ScoutRunBoxes } from "./ScoutRunBoxes";

/**
 * The one scout card: dot, name, badges, cadence, emitted count, run boxes,
 * enable switch, and a gear that expands the settings form. Used both as the
 * fleet list row and as the header card on the scout detail screen, so the
 * two surfaces always look and behave the same.
 */
export function ScoutRowCard({
  config,
  rollup,
  onUpdate,
  linkToDetail = true,
}: {
  config: ScoutConfig;
  rollup: ScoutRollup | undefined;
  onUpdate: (configId: string, updates: ScoutConfigUpdate) => void;
  linkToDetail?: boolean;
}) {
  const now = new Date();
  const state = deriveScoutRowState(config, rollup, now);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cloudSkillUrl = skillUrl(config.skill_name);

  const title = (
    <>
      <ScoutStatusDot state={state} />
      <Text className="truncate font-medium text-[13px] text-gray-12">
        {prettifyScoutSkillName(config.skill_name)}
      </Text>
    </>
  );

  return (
    <Flex
      direction="column"
      className={`group relative rounded-(--radius-3) border border-border bg-(--color-panel-solid) px-4 py-3 transition duration-150 hover:border-(--gray-6) hover:bg-(--gray-2) ${
        config.enabled ? "" : "opacity-65"
      }`}
    >
      <Flex align="center" gap="4">
        <Flex align="center" gap="2" className="min-w-0 flex-1">
          {linkToDetail ? (
            <Link
              to="/code/agents/scouts/$skillName"
              params={{ skillName: scoutSkillSlug(config.skill_name) }}
              className={`flex min-w-0 items-center gap-2 no-underline ${
                settingsOpen ? "" : "after:absolute after:inset-0"
              }`}
            >
              {title}
            </Link>
          ) : (
            <Flex align="center" gap="2" className="min-w-0">
              {title}
            </Flex>
          )}
          {cloudSkillUrl ? (
            <Tooltip content="View skill in PostHog">
              <a
                href={cloudSkillUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${config.skill_name} skill in PostHog`}
                className="relative text-gray-9 transition-colors hover:text-accent-11"
              >
                <ArrowSquareOutIcon size={12} />
              </a>
            </Tooltip>
          ) : null}
          <ScoutOriginBadge skillName={config.skill_name} />
          <DryRunBadge config={config} />
          <Text className="whitespace-nowrap text-[11px] text-gray-10">
            {formatRunIntervalShort(config.run_interval_minutes)}
          </Text>
          {rollup && rollup.emittedCount > 0 ? (
            <Text className="whitespace-nowrap text-[11px] text-gray-10">
              · {rollup.emittedCount} signal
              {rollup.emittedCount === 1 ? "" : "s"} emitted
            </Text>
          ) : null}
        </Flex>
        <Box className="relative shrink-0">
          <ScoutRunBoxes runs={rollup?.runs ?? []} />
        </Box>
        <Flex align="center" gap="3" className="relative shrink-0">
          <ScoutEnabledSwitch config={config} onUpdate={onUpdate} />
          <Tooltip content="Scout settings">
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-expanded={settingsOpen}
              aria-label={`${config.skill_name} settings`}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                settingsOpen
                  ? "bg-(--gray-4) text-gray-12"
                  : "text-gray-10 hover:bg-(--gray-3) hover:text-gray-12"
              }`}
            >
              <GearSixIcon size={14} />
            </button>
          </Tooltip>
        </Flex>
      </Flex>
      {settingsOpen ? (
        <Box className="mt-3 border-(--gray-4) border-t pt-3">
          <ScoutConfigForm config={config} onUpdate={onUpdate} />
        </Box>
      ) : null}
    </Flex>
  );
}
