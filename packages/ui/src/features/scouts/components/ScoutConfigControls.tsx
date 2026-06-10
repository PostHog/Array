import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import {
  formatRunInterval,
  RUN_INTERVAL_OPTIONS,
} from "@posthog/core/scouts/scoutPresentation";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { Flex, Switch, Tooltip } from "@radix-ui/themes";
import { useMemo } from "react";
import type { ScoutConfigUpdate } from "../hooks/useScoutConfigMutations";

const MODE_OPTIONS = [
  { value: "live", label: "Live" },
  { value: "dry_run", label: "Dry run" },
];

interface ScoutConfigControlsProps {
  config: ScoutConfig;
  onUpdate: (configId: string, updates: ScoutConfigUpdate) => void;
}

/**
 * The three per-scout controls: live vs dry-run, cadence, and on/off.
 * Used inline on fleet rows and in the scout detail header so config never
 * requires leaving the current view.
 */
export function ScoutConfigControls({
  config,
  onUpdate,
}: ScoutConfigControlsProps) {
  const intervalOptions = useMemo(() => {
    const options = RUN_INTERVAL_OPTIONS.map((option) => ({
      value: String(option.minutes),
      label: option.label,
    }));
    if (
      !RUN_INTERVAL_OPTIONS.some(
        (option) => option.minutes === config.run_interval_minutes,
      )
    ) {
      options.push({
        value: String(config.run_interval_minutes),
        label: formatRunInterval(config.run_interval_minutes),
      });
    }
    return options;
  }, [config.run_interval_minutes]);

  return (
    <Flex align="center" gap="3" className="shrink-0">
      <Tooltip content="Dry run executes the scout but holds back its findings">
        <span>
          <SettingsOptionSelect
            value={config.emit ? "live" : "dry_run"}
            options={MODE_OPTIONS}
            ariaLabel={`${config.skill_name} mode`}
            disabled={!config.enabled}
            className="w-24"
            onValueChange={(value) =>
              onUpdate(config.id, { emit: value === "live" })
            }
          />
        </span>
      </Tooltip>
      <SettingsOptionSelect
        value={String(config.run_interval_minutes)}
        options={intervalOptions}
        ariaLabel={`${config.skill_name} run interval`}
        disabled={!config.enabled}
        className="w-36"
        onValueChange={(value) =>
          onUpdate(config.id, { run_interval_minutes: Number(value) })
        }
      />
      <Tooltip content={config.enabled ? "Disable scout" : "Enable scout"}>
        <Switch
          size="1"
          checked={config.enabled}
          onCheckedChange={(checked) =>
            onUpdate(config.id, { enabled: checked })
          }
          aria-label={`${config.skill_name} enabled`}
        />
      </Tooltip>
    </Flex>
  );
}
