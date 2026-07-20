import { getDeeplinkProtocol } from "@posthog/shared";
import { CopyableCommand } from "@posthog/ui/features/settings/CopyableCommand";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import { Flex } from "@radix-ui/themes";

const DEEPLINK_TEMPLATE = `${getDeeplinkProtocol(import.meta.env.DEV)}://new?repo=OWNER/REPO&source=linear&issue={{issue.identifier}}&prompt={{context}}`;

export function LinearSettings() {
  return (
    <Flex direction="column">
      <SettingRow
        label="Open issues from Linear"
        description="In Linear, go to Settings → Code & reviews and add a custom coding tool with this URL. Replace OWNER/REPO with your repository. {{issue.identifier}} and {{context}} are Linear template variables substituted when the tool is launched."
        noBorder
      >
        <CopyableCommand command={DEEPLINK_TEMPLATE} />
      </SettingRow>
    </Flex>
  );
}
