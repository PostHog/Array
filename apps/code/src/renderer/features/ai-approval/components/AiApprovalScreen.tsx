import { FullScreenLayout } from "@components/FullScreenLayout";
import { useLogoutMutation } from "@features/auth/hooks/authMutations";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { SettingsDialog } from "@features/settings/components/SettingsDialog";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import {
  ArrowSquareOut,
  GearSix,
  Robot,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Callout, Flex, Text } from "@radix-ui/themes";
import { SHORTCUTS } from "@renderer/constants/keyboard-shortcuts";
import { trpcClient } from "@renderer/trpc/client";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { motion } from "framer-motion";
import { useHotkeys } from "react-hotkeys-hook";

interface AiApprovalScreenProps {
  orgName: string | null;
  isAdmin: boolean;
}

export function AiApprovalScreen({ orgName, isAdmin }: AiApprovalScreenProps) {
  const logoutMutation = useLogoutMutation();
  const openSettings = useSettingsDialogStore((s) => s.open);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);

  useHotkeys(SHORTCUTS.SETTINGS, () => openSettings(), {
    preventDefault: true,
    enableOnFormTags: true,
  });

  const approvalUrl = cloudRegion
    ? `${getCloudUrlFromRegion(cloudRegion)}/settings/organization-details#organization-ai-consent`
    : null;

  const openApproval = () => {
    if (!approvalUrl) return;
    void trpcClient.os.openExternal.mutate({ url: approvalUrl });
  };

  const footerLeft = (
    <Button
      size="1"
      variant="ghost"
      color="gray"
      onClick={() => openSettings()}
      className="opacity-70"
    >
      <GearSix size={14} />
      Settings
    </Button>
  );

  const footerRight = (
    <Button
      size="1"
      variant="ghost"
      color="gray"
      onClick={() => logoutMutation.mutate()}
      className="opacity-50"
    >
      <SignOut size={14} />
      Log out
    </Button>
  );

  return (
    <>
      <FullScreenLayout footerLeft={footerLeft} footerRight={footerRight}>
        <Flex align="center" justify="center" height="100%" px="8">
          <Flex
            direction="column"
            className="w-full max-w-[560px] pt-[24px] pb-[40px]"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Flex direction="column" gap="4">
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <Robot
                      size={22}
                      weight="duotone"
                      color="var(--accent-10)"
                    />
                    <Text className="font-bold text-(--gray-12) text-2xl">
                      PostHog AI needs your approval
                    </Text>
                  </Flex>
                  <Text className="text-(--gray-11) text-sm">
                    {orgName ? (
                      <>
                        Your "<strong>{orgName}</strong>" organization hasn't
                        approved AI data processing yet.
                      </>
                    ) : (
                      "Your organization hasn't approved AI data processing yet."
                    )}
                  </Text>
                  <Text className="text-(--gray-11) text-sm">
                    PostHog AI features process identifying user data with
                    external AI providers.
                    <br />
                    Importantly: Your data won't be used for training models by
                    these providers.
                  </Text>
                </Flex>

                <Callout.Root color="amber" size="1" variant="soft">
                  <Callout.Icon>
                    <WarningCircle />
                  </Callout.Icon>
                  <Callout.Text>
                    <h4 className="mb-1 font-bold">
                      Legal bits about Protected Health Information
                    </h4>
                    PostHog Code isn't <i>yet</i> HIPAA-compliant and is not
                    intended for processing of Protected Health Information
                    ("PHI").
                    <br />
                    If you've entered into a Business Associate Agreement
                    ("BAA") with PostHog, it does not currently apply to PostHog
                    Code features.
                  </Callout.Text>
                </Callout.Root>

                {isAdmin ? (
                  <Flex direction="column" gap="2">
                    <Button
                      size="3"
                      onClick={openApproval}
                      disabled={!approvalUrl}
                      className="w-full"
                    >
                      Approve in PostHog
                      <ArrowSquareOut size={16} />
                    </Button>
                    <Text className="text-(--gray-10) text-[13px]">
                      Opens PostHog in your browser. Come back here once you've
                      approved.
                    </Text>
                  </Flex>
                ) : (
                  <Text className="text-(--gray-11) text-sm">
                    Ask an organization admin to approve AI data processing.
                  </Text>
                )}
              </Flex>
            </motion.div>
          </Flex>
        </Flex>
      </FullScreenLayout>
      <SettingsDialog />
    </>
  );
}
