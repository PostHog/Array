import { ANALYTICS_EVENTS } from "@posthog/shared";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useDebounce } from "@posthog/ui/primitives/hooks/useDebounce";
import { track } from "@posthog/ui/shell/analytics";
import { Flex, Text, TextArea } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";

const MAX_INSTRUCTIONS_LENGTH = 2000;

export function PersonalizationSettings() {
  const customInstructions = useSettingsStore((s) => s.customInstructions);
  const setCustomInstructions = useSettingsStore(
    (s) => s.setCustomInstructions,
  );

  const [localInstructions, setLocalInstructions] =
    useState(customInstructions);
  const debouncedInstructions = useDebounce(localInstructions, 500);

  // Sync local state when store changes externally
  useEffect(() => {
    setLocalInstructions(customInstructions);
  }, [customInstructions]);

  const saveInstructions = useCallback(
    (value: string) => {
      const current = useSettingsStore.getState().customInstructions;
      if (value === current) return;
      setCustomInstructions(value);
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "custom_instructions",
        new_value: value.length > 0,
      });
    },
    [setCustomInstructions],
  );

  useEffect(() => {
    saveInstructions(debouncedInstructions);
  }, [debouncedInstructions, saveInstructions]);

  const handleInstructionsBlur = useCallback(() => {
    saveInstructions(localInstructions);
  }, [localInstructions, saveInstructions]);

  return (
    <Flex direction="column" gap="1" py="4">
      <Flex direction="column" gap="1" className="mb-2">
        <Text className="font-medium text-sm">Custom instructions</Text>
        <Text color="gray" className="text-[13px]">
          Instructions included in every agent session
        </Text>
      </Flex>
      <TextArea
        value={localInstructions}
        onChange={(e) => setLocalInstructions(e.target.value)}
        onBlur={handleInstructionsBlur}
        maxLength={MAX_INSTRUCTIONS_LENGTH}
        placeholder="e.g. Always write tests for new code. Prefer functional patterns."
        rows={6}
        size="1"
        className="w-full"
      />
      <Text color="gray" align="right" className="text-[13px]">
        {localInstructions.length}/{MAX_INSTRUCTIONS_LENGTH}
      </Text>
    </Flex>
  );
}
