import type { CodeUserNotificationSettings } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const CODE_USER_NOTIFICATION_SETTINGS_QUERY_KEY = [
  "code-user-notification-settings",
] as const;

/** The user's PostHog Code notification settings (all-defaults until first saved). */
export function useCodeUserNotificationSettings() {
  return useAuthenticatedQuery(
    CODE_USER_NOTIFICATION_SETTINGS_QUERY_KEY,
    (client) => client.getCodeUserNotificationSettings(),
  );
}

/** Mutations for the settings above; reads come from `useCodeUserNotificationSettings`. */
export function useCodeUserNotificationSettingsMutations() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const handleUpdateSlackMentionNotifications = useCallback(
    async (enabled: boolean) => {
      if (!client) return;
      const previous = queryClient.getQueryData<CodeUserNotificationSettings>(
        CODE_USER_NOTIFICATION_SETTINGS_QUERY_KEY,
      );
      // Optimistic: the switch reflects the new state immediately, reverted on failure.
      queryClient.setQueryData<CodeUserNotificationSettings>(
        CODE_USER_NOTIFICATION_SETTINGS_QUERY_KEY,
        { slack_mention_notifications: enabled },
      );
      try {
        const fresh = await client.updateCodeUserNotificationSettings({
          slack_mention_notifications: enabled,
        });
        queryClient.setQueryData(
          CODE_USER_NOTIFICATION_SETTINGS_QUERY_KEY,
          fresh,
        );
      } catch (error: unknown) {
        queryClient.setQueryData(
          CODE_USER_NOTIFICATION_SETTINGS_QUERY_KEY,
          previous,
        );
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update mention notifications";
        toast.error(message);
      }
    },
    [client, queryClient],
  );

  return { handleUpdateSlackMentionNotifications };
}
