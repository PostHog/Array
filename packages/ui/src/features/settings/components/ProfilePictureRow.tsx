import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import {
  authKeys,
  useCurrentUser,
} from "@posthog/ui/features/auth/useCurrentUser";
import { UserAvatar } from "@posthog/ui/features/avatars/UserAvatar";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Flex, TextField } from "@radix-ui/themes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Settings row for the account profile picture: preview, an https image URL
 * to set/change it, and removal. Saves to the PostHog account so every client
 * (and teammate) sees it.
 */
export function ProfilePictureRow() {
  const bluebirdEnabled = useFeatureFlag(PROJECT_BLUEBIRD_FLAG);
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser({
    client,
    enabled: isAuthenticated,
  });
  // The generated API types don't carry avatar_url yet (new backend field).
  const savedUrl =
    (user as { avatar_url?: string | null } | undefined)?.avatar_url ?? null;
  // null = no unsaved edits; the input shows the saved value.
  const [draft, setDraft] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (avatarUrl: string | null) => {
      if (!client) throw new Error("Not authenticated");
      await client.updateCurrentUserAvatar(avatarUrl);
      return avatarUrl;
    },
    onSuccess: (avatarUrl) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "avatar_url",
        new_value: avatarUrl ? "set" : "removed",
      });
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: authKeys.currentUsers() });
      toast.success(
        avatarUrl ? "Profile picture updated" : "Profile picture removed",
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update profile picture",
      );
    },
  });

  if (!bluebirdEnabled || !user) return null;

  const value = draft ?? savedUrl ?? "";
  const trimmed = value.trim();
  const canSave =
    draft !== null &&
    trimmed !== (savedUrl ?? "") &&
    (trimmed === "" || trimmed.startsWith("https://")) &&
    !mutation.isPending;

  return (
    <SettingRow
      label="Profile picture"
      description="Shown on your messages and mentions across PostHog. Paste an https image URL."
    >
      <Flex align="center" gap="2">
        <UserAvatar
          user={user ? { ...user, avatar_url: savedUrl } : null}
          size="sm"
        />
        <TextField.Root
          size="1"
          placeholder="https://…"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          className="w-[220px]"
        />
        <Button
          size="1"
          variant="outline"
          disabled={!canSave}
          loading={mutation.isPending && mutation.variables !== null}
          onClick={() => mutation.mutate(trimmed === "" ? null : trimmed)}
        >
          Save
        </Button>
        {savedUrl && (
          <Button
            size="1"
            variant="outline"
            color="red"
            disabled={mutation.isPending}
            loading={mutation.isPending && mutation.variables === null}
            onClick={() => mutation.mutate(null)}
          >
            Remove
          </Button>
        )}
      </Flex>
    </SettingRow>
  );
}
