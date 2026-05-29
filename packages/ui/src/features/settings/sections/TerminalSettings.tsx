import { ANALYTICS_EVENTS } from "@posthog/shared";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import {
  type TerminalFont,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
import { useDebounce } from "@posthog/ui/primitives/hooks/useDebounce";
import { track } from "@posthog/ui/shell/analytics";
import { Flex, Select, Text, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";

export function TerminalSettings() {
  const terminalFont = useSettingsStore((s) => s.terminalFont);
  const setTerminalFont = useSettingsStore((s) => s.setTerminalFont);
  const terminalCustomFontFamily = useSettingsStore(
    (s) => s.terminalCustomFontFamily,
  );
  const setTerminalCustomFontFamily = useSettingsStore(
    (s) => s.setTerminalCustomFontFamily,
  );

  const [draftCustomFont, setDraftCustomFont] = useState(
    terminalCustomFontFamily,
  );
  const debouncedCustomFont = useDebounce(draftCustomFont, 500);

  // Pull external changes (hydration, devtools) into the draft.
  useEffect(() => {
    setDraftCustomFont(terminalCustomFontFamily);
  }, [terminalCustomFontFamily]);

  // Commit the debounced draft back to the store. The equality guard breaks
  // the draft<->store loop: writing the store would re-fire the pull-in effect
  // above, which would re-fire this one without it.
  useEffect(() => {
    if (debouncedCustomFont === terminalCustomFontFamily) return;
    setTerminalCustomFontFamily(debouncedCustomFont);
    track(ANALYTICS_EVENTS.SETTING_CHANGED, {
      setting_name: "terminal_custom_font_family",
      new_value: debouncedCustomFont.length > 0,
    });
  }, [
    debouncedCustomFont,
    terminalCustomFontFamily,
    setTerminalCustomFontFamily,
  ]);

  const handleFontChange = (value: TerminalFont) => {
    track(ANALYTICS_EVENTS.SETTING_CHANGED, {
      setting_name: "terminal_font",
      new_value: value,
      old_value: terminalFont,
    });
    setTerminalFont(value);
  };

  const showCustomInput = terminalFont === "custom";

  return (
    <Flex direction="column" gap="1" py="4">
      <SettingRow
        label="Font"
        description="Font used to render the terminal output"
        noBorder={!showCustomInput}
      >
        <Select.Root
          value={terminalFont}
          onValueChange={(value) => handleFontChange(value as TerminalFont)}
          size="1"
        >
          <Select.Trigger className="min-w-[160px]" />
          <Select.Content>
            <Select.Item value="berkeley-mono">Berkeley Mono</Select.Item>
            <Select.Item value="jetbrains-mono">JetBrains Mono</Select.Item>
            <Select.Item value="system">System monospace</Select.Item>
            <Select.Item value="custom">Custom</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingRow>

      {showCustomInput && (
        <SettingRow
          label="Custom font family"
          description="Any CSS font-family value. Example: Fira Code, Cascadia Code"
          noBorder
        >
          <Flex direction="column" align="end" gap="1">
            <TextField.Root
              value={draftCustomFont}
              onChange={(e) => setDraftCustomFont(e.target.value)}
              placeholder="Fira Code"
              size="1"
              className="min-w-[240px]"
            />
            <Text color="gray" className="text-[12px]">
              Falls back to Berkeley Mono if unavailable
            </Text>
          </Flex>
        </SettingRow>
      )}
    </Flex>
  );
}
