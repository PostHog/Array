import { Plus } from "@phosphor-icons/react";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import { AddCustomSoundDialog } from "@posthog/ui/features/settings/sections/AddCustomSoundDialog";
import { ProducerTagSection } from "@posthog/ui/features/settings/sections/NotificationsSettings";
import {
  type CompletionSound,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
import { Button, Flex } from "@radix-ui/themes";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

// A focused stand-in for the sound-related rows of the Notifications settings
// page, wired to the real settings store, the real Add-custom-sound dialog and
// the real ProducerTagSection — enough to demo importing a tag and playing it
// without pulling in the full page's service-backed hooks (tasks, host
// capabilities, notification bus).
function ProducerTagDemo() {
  const customSounds = useSettingsStore((s) => s.customSounds);
  const producerTagSound = useSettingsStore((s) => s.producerTagSound);
  const producerTagVolume = useSettingsStore((s) => s.producerTagVolume);
  const setProducerTagSound = useSettingsStore((s) => s.setProducerTagSound);
  const setProducerTagVolume = useSettingsStore((s) => s.setProducerTagVolume);
  const [addOpen, setAddOpen] = useState(false);

  // Start each mount from a clean slate so the demo is deterministic.
  useEffect(() => {
    useSettingsStore.setState({
      customSounds: [],
      completionSound: "none",
      producerTagSound: "none",
      producerTagVolume: 80,
    });
  }, []);

  return (
    <Flex direction="column">
      <SettingRow
        label="Custom sounds"
        description="Record or import your own sound — e.g. your producer tag."
      >
        <Button
          variant="soft"
          size="1"
          className="self-start"
          onClick={() => setAddOpen(true)}
        >
          <Plus /> Add
        </Button>
      </SettingRow>

      <AddCustomSoundDialog open={addOpen} onOpenChange={setAddOpen} />

      <ProducerTagSection
        sound={producerTagSound}
        volume={producerTagVolume}
        customSounds={customSounds}
        onSoundChange={(value: CompletionSound) => setProducerTagSound(value)}
        onVolumeChange={setProducerTagVolume}
        onAddSound={() => setAddOpen(true)}
      />
    </Flex>
  );
}

const meta: Meta<typeof ProducerTagDemo> = {
  title: "Settings/ProducerTag",
  component: ProducerTagDemo,
  // Match the settings dialog's content column so rows size realistically.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProducerTagDemo>;

/**
 * Import a sound as your producer tag, then play it — the drop that fires when
 * you push code to origin.
 */
export const Default: Story = {};
