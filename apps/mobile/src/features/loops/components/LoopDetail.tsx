import { Text } from "@components/text";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { modelLabel } from "@/features/tasks/composer/options";
import { useThemeColors } from "@/lib/theme";
import type { Loop, LoopRun } from "../types";
import { getLoopRepositoryLabel } from "../utils/loopPresentation";
import { describeTrigger } from "../utils/loopTriggers";
import { LoopRunHistory } from "./LoopRunHistory";
import { LoopStatusBadge } from "./LoopStatusBadge";

interface LoopDetailProps {
  loop: Loop;
  isWorking?: boolean;
  onRunNow: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunPress?: (run: LoopRun) => void;
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-gray-9 text-xs">{label}</Text>
      <Text className="mt-1 text-gray-12 text-sm">{value}</Text>
    </View>
  );
}

function BehaviorChips({ loop }: { loop: Loop }) {
  const chips: string[] = [];
  if (loop.behaviors.create_prs) chips.push("Opens PRs");
  if (loop.behaviors.watch_ci) chips.push("Watches CI");
  if (loop.behaviors.fix_review_comments) chips.push("Fixes review comments");

  if (chips.length === 0) {
    return <Text className="mt-1 text-gray-12 text-sm">Report-only</Text>;
  }

  return (
    <View className="mt-1 flex-row flex-wrap gap-2">
      {chips.map((chip) => (
        <View key={chip} className="rounded bg-gray-4 px-1.5 py-0.5">
          <Text className="text-gray-11 text-xs">{chip}</Text>
        </View>
      ))}
    </View>
  );
}

export function LoopDetail({
  loop,
  isWorking = false,
  onRunNow,
  onToggleEnabled,
  onEdit,
  onDelete,
  onRunPress,
}: LoopDetailProps) {
  const themeColors = useThemeColors();
  const [tab, setTab] = useState<"config" | "runs">("config");
  const repositoryLabel = getLoopRepositoryLabel(loop);
  const enabledChannels = (["push", "email", "slack"] as const).filter(
    (channel) => loop.notifications[channel].enabled,
  );

  return (
    <View>
      <View className="rounded-xl border border-gray-6 bg-gray-1 px-4 py-4">
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 font-semibold text-gray-12 text-lg">
            {loop.name}
          </Text>
          <View className="rounded bg-gray-4 px-1.5 py-0.5">
            <Text className="text-gray-11 text-xs">
              {loop.visibility === "team" ? "Team" : "Personal"}
            </Text>
          </View>
        </View>
        <View className="mt-3">
          <LoopStatusBadge
            enabled={loop.enabled}
            lastRunStatus={loop.last_run_status}
          />
        </View>
        {loop.description ? (
          <Text className="mt-3 text-gray-11 text-sm">{loop.description}</Text>
        ) : null}
      </View>

      <View className="mt-4 flex-row gap-2">
        {(["config", "runs"] as const).map((value) => {
          const isSelected = tab === value;
          return (
            <Pressable
              key={value}
              onPress={() => setTab(value)}
              className={`flex-1 rounded-xl border py-2.5 ${
                isSelected
                  ? "border-accent-9 bg-accent-3"
                  : "border-gray-5 bg-background"
              }`}
            >
              <Text
                className={`text-center font-medium text-[13px] ${
                  isSelected ? "text-accent-11" : "text-gray-11"
                }`}
              >
                {value === "config" ? "Config" : "Run history"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "config" ? (
        <View className="mt-4 gap-4 rounded-xl bg-gray-2 p-4">
          <ConfigRow
            label="Model"
            value={`${loop.runtime_adapter === "codex" ? "Codex" : "Claude Code"} · ${modelLabel(loop.model)}${
              loop.reasoning_effort ? ` · ${loop.reasoning_effort}` : ""
            }`}
          />
          <ConfigRow
            label="Repository"
            value={repositoryLabel ?? "None — connectors only"}
          />
          <View>
            <Text className="text-gray-9 text-xs">Instructions</Text>
            <Text className="mt-1 text-gray-12 text-sm">
              {loop.instructions}
            </Text>
          </View>
          <View>
            <Text className="text-gray-9 text-xs">
              Triggers ({loop.triggers.length})
            </Text>
            {loop.triggers.length === 0 ? (
              <Text className="mt-1 text-gray-12 text-sm">No triggers</Text>
            ) : (
              <View className="mt-1 gap-1.5">
                {loop.triggers.map((trigger) => (
                  <Text key={trigger.id} className="text-gray-12 text-sm">
                    {trigger.enabled ? "" : "(paused) "}
                    {describeTrigger(trigger)}
                  </Text>
                ))}
              </View>
            )}
          </View>
          <View>
            <Text className="text-gray-9 text-xs">Behaviors</Text>
            <BehaviorChips loop={loop} />
          </View>
          <ConfigRow
            label="Notifications"
            value={
              enabledChannels.length > 0
                ? enabledChannels
                    .map(
                      (channel) => channel[0].toUpperCase() + channel.slice(1),
                    )
                    .join(", ")
                : "None"
            }
          />
          {loop.last_error && (
            <View className="rounded-lg bg-status-error/10 px-3 py-3">
              <Text className="text-status-error text-xs">Last error</Text>
              <Text className="mt-1 text-sm text-status-error">
                {loop.last_error}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View className="mt-4">
          <LoopRunHistory loopId={loop.id} onRunPress={onRunPress} />
        </View>
      )}

      <View className="mt-4 gap-3">
        <Pressable
          onPress={onRunNow}
          disabled={isWorking}
          className="rounded-lg bg-accent-9 py-3"
        >
          {isWorking ? (
            <ActivityIndicator
              size="small"
              color={themeColors.accent.contrast}
            />
          ) : (
            <Text className="text-center font-medium text-accent-contrast">
              Run now
            </Text>
          )}
        </Pressable>

        <View className="flex-row gap-3">
          <Pressable
            onPress={onEdit}
            className="flex-1 rounded-lg border border-gray-6 py-3"
          >
            <Text className="text-center font-medium text-gray-12">Edit</Text>
          </Pressable>
          <Pressable
            onPress={onToggleEnabled}
            className="flex-1 rounded-lg border border-gray-6 py-3"
          >
            <Text className="text-center font-medium text-gray-12">
              {loop.enabled ? "Pause" : "Resume"}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={onDelete}
          className="rounded-lg border border-status-error/30 py-3"
        >
          <Text className="text-center font-medium text-status-error">
            Delete loop
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
