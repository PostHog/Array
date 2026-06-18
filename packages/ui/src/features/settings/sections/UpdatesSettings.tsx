import { CheckCircle, XCircle } from "@phosphor-icons/react";
import { deriveUpdateStatus } from "@posthog/core/settings/updateStatus";
import { useHostTRPC } from "@posthog/host-router/react";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import { logger } from "@posthog/ui/shell/logger";
import { Badge, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useRef, useState } from "react";

const log = logger.scope("updates-settings");

export function UpdatesSettings() {
  const trpc = useHostTRPC();
  const { data: appVersion } = useQuery(trpc.os.getAppVersion.queryOptions());
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updatesDisabled, setUpdatesDisabled] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    message?: string;
    type?: "info" | "success" | "error";
  }>({});
  const hasCheckedRef = useRef(false);

  const checkUpdatesMutation = useMutation(
    trpc.updates.check.mutationOptions(),
  );

  const handleCheckForUpdates = useCallback(async () => {
    setCheckingForUpdates(true);
    setUpdateStatus({ message: "Checking for updates...", type: "info" });

    try {
      const result = await checkUpdatesMutation.mutateAsync();

      if (result.success) {
        setUpdateStatus({
          message: "Checking for updates...",
          type: "info",
        });
      } else if (result.errorCode === "already_checking") {
        // A check is already in progress (e.g. boot check) — show spinner and wait
        setUpdateStatus({ message: "Checking for updates...", type: "info" });
      } else {
        if (result.errorCode === "disabled") {
          setUpdatesDisabled(true);
        }
        setUpdateStatus({
          message: result.errorMessage || "Failed to check for updates",
          type: "error",
        });
        setCheckingForUpdates(false);
      }
    } catch (error) {
      log.error("Failed to check for updates:", error);
      setUpdateStatus({
        message: "An unexpected error occurred",
        type: "error",
      });
      setCheckingForUpdates(false);
    }
  }, [checkUpdatesMutation]);

  useEffect(() => {
    if (!hasCheckedRef.current) {
      hasCheckedRef.current = true;
      handleCheckForUpdates();
    }
  }, [handleCheckForUpdates]);

  useSubscription(
    trpc.updates.onStatus.subscriptionOptions(undefined, {
      onData: (status) => {
        const derived = deriveUpdateStatus(status);
        if (derived.message) {
          setUpdateStatus({ message: derived.message, type: derived.type });
        }
        if (derived.checking === false) {
          setCheckingForUpdates(false);
        }
      },
    }),
  );

  return (
    <Flex direction="column">
      <SettingRow label="Current version">
        <Badge size="1" variant="soft" color="gray">
          {appVersion || "Loading..."}
        </Badge>
      </SettingRow>

      <SettingRow
        label="Check for updates"
        description="Automatically checks for new versions on startup"
        noBorder
      >
        <Flex align="center" gap="3">
          {updateStatus.message && (
            <Flex align="center" gap="1">
              {updateStatus.type === "info" && checkingForUpdates && (
                <Spinner size="1" />
              )}
              {updateStatus.type === "success" && (
                <CheckCircle size={14} weight="fill" className="text-green-9" />
              )}
              {updateStatus.type === "error" && (
                <XCircle size={14} weight="fill" className="text-red-9" />
              )}
              <Text
                color={
                  updateStatus.type === "error"
                    ? "red"
                    : updateStatus.type === "success"
                      ? "green"
                      : "gray"
                }
                className="text-[13px]"
              >
                {updateStatus.message}
              </Text>
            </Flex>
          )}
          {!updatesDisabled && (
            <Button
              variant="soft"
              size="1"
              onClick={handleCheckForUpdates}
              disabled={checkingForUpdates}
            >
              {checkingForUpdates ? "Checking..." : "Check now"}
            </Button>
          )}
        </Flex>
      </SettingRow>
    </Flex>
  );
}
