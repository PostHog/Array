import { Text } from "@components/text";
import { Pressable, TextInput, View } from "react-native";
import {
  MODELS,
  REASONING_LEVELS,
  type ReasoningEffort,
} from "@/features/tasks/composer/options";
import { useThemeColors } from "@/lib/theme";
import type { LoopReasoningEffort, LoopRuntimeAdapter } from "../types";

interface ModelPickerProps {
  runtimeAdapter: LoopRuntimeAdapter;
  model: string;
  reasoningEffort: LoopReasoningEffort | null;
  onRuntimeAdapterChange: (adapter: LoopRuntimeAdapter) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: LoopReasoningEffort | null) => void;
}

const ADAPTER_OPTIONS: Array<{ value: LoopRuntimeAdapter; label: string }> = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

function ChipRow<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ value: T; label: string }>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            className={`rounded-xl border px-3 py-2 ${
              isSelected
                ? "border-accent-8 bg-accent-3"
                : "border-gray-5 bg-background"
            }`}
          >
            <Text
              className={`text-sm ${
                isSelected ? "text-accent-11" : "text-gray-11"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ModelPicker({
  runtimeAdapter,
  model,
  reasoningEffort,
  onRuntimeAdapterChange,
  onModelChange,
  onReasoningEffortChange,
}: ModelPickerProps) {
  const themeColors = useThemeColors();

  return (
    <View className="gap-4">
      <View>
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Adapter
        </Text>
        <ChipRow
          options={ADAPTER_OPTIONS}
          selected={runtimeAdapter}
          onSelect={onRuntimeAdapterChange}
        />
      </View>

      <View>
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Model
        </Text>
        {runtimeAdapter === "claude" && (
          <View className="mb-2">
            <ChipRow
              options={MODELS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              selected={model}
              onSelect={onModelChange}
            />
          </View>
        )}
        <TextInput
          className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
          placeholder={
            runtimeAdapter === "claude" ? "claude-opus-4-8" : "gpt-5.1-codex"
          }
          placeholderTextColor={themeColors.gray[9]}
          value={model}
          onChangeText={onModelChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View>
        <Text
          className="mb-2 text-[11px] text-gray-9 uppercase"
          style={{ letterSpacing: 0.5 }}
        >
          Reasoning effort
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            onPress={() => onReasoningEffortChange(null)}
            className={`rounded-xl border px-3 py-2 ${
              reasoningEffort === null
                ? "border-accent-8 bg-accent-3"
                : "border-gray-5 bg-background"
            }`}
          >
            <Text
              className={`text-sm ${
                reasoningEffort === null ? "text-accent-11" : "text-gray-11"
              }`}
            >
              Default
            </Text>
          </Pressable>
          <ChipRow<ReasoningEffort>
            options={REASONING_LEVELS}
            selected={(reasoningEffort ?? "") as ReasoningEffort}
            onSelect={(value) => onReasoningEffortChange(value)}
          />
        </View>
      </View>
    </View>
  );
}
