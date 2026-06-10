import { CaretRightIcon, CompassIcon } from "@phosphor-icons/react";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useScoutConfigs } from "../hooks/useScoutConfigs";

/**
 * Compact entry card for the agents config page. All scout management lives
 * behind it at /code/agents/scouts; this just shows a pulse.
 */
export function ScoutsSummaryCard() {
  const { data: configs, isLoading } = useScoutConfigs();

  const lastRunAt = useMemo(() => {
    let latest: string | null = null;
    for (const config of configs ?? []) {
      if (config.last_run_at && (!latest || config.last_run_at > latest)) {
        latest = config.last_run_at;
      }
    }
    return latest;
  }, [configs]);

  const enabledCount = (configs ?? []).filter(
    (config) => config.enabled,
  ).length;
  const totalCount = configs?.length ?? 0;

  return (
    <Link
      to="/code/agents/scouts"
      className="flex items-center justify-between gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 no-underline transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex align="center" gap="3" className="min-w-0">
        <CompassIcon size={20} className="shrink-0 text-(--iris-9)" />
        <Flex direction="column" gap="0" className="min-w-0">
          <Text className="font-medium text-[13px] text-gray-12">
            Manage scouts
          </Text>
          <Text className="text-[12px] text-gray-11 leading-snug">
            {isLoading ? (
              "Loading the fleet..."
            ) : totalCount === 0 ? (
              "Scheduled agents that sweep this project and emit findings to your inbox."
            ) : (
              <>
                {enabledCount} of {totalCount} scouts enabled
                {lastRunAt ? (
                  <>
                    {" · last dispatched "}
                    <RelativeTimestamp timestamp={lastRunAt} />
                  </>
                ) : null}
              </>
            )}
          </Text>
        </Flex>
      </Flex>
      <CaretRightIcon size={14} className="shrink-0 text-gray-10" />
    </Link>
  );
}
