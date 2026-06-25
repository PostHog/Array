import { useServiceOptional } from "@posthog/di/react";
import {
  type INotifications,
  NOTIFICATIONS_SERVICE,
} from "@posthog/platform/notifications";
import { ANALYTICS_EVENTS, PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import {
  type CompletionSound,
  NOTIFICATION_DEFAULTS,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { playCompletionSound } from "@posthog/ui/utils/sounds";
import { Button, Flex, Select, Slider, Switch, Text } from "@radix-ui/themes";
import { useCallback, useEffect } from "react";

export function NotificationsSettings() {
  const {
    desktopNotifications,
    dockBadgeNotifications,
    dockBounceNotifications,
    completionSound,
    completionVolume,
    setDesktopNotifications,
    setDockBadgeNotifications,
    setDockBounceNotifications,
    setCompletionSound,
    setCompletionVolume,
  } = useSettingsStore();

  // Optional so non-desktop hosts (web) that don't bind these simply disable the
  // native test buttons instead of throwing.
  const bus = useServiceOptional<NotificationBus>(NotificationBus);
  const notifications = useServiceOptional<INotifications>(
    NOTIFICATIONS_SERVICE,
  );

  // Canvases only exist behind the bluebird flag, so only mention them when on.
  const canvasEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );

  // The most recent task, used to demo a real deep-link notification.
  const { data: tasks } = useTasks();
  const deepLinkTask = tasks?.[0];

  // Sync the toggle off if the user denied notification permission at the OS
  // level (otherwise it claims to be on but the OS silently drops everything).
  useEffect(() => {
    if (window.Notification?.permission === "denied" && desktopNotifications) {
      setDesktopNotifications(false);
    }
  }, [desktopNotifications, setDesktopNotifications]);

  const notificationsDenied = window.Notification?.permission === "denied";

  const handleDesktopNotificationsChange = useCallback(
    async (checked: boolean) => {
      if (checked) {
        const permission = await window.Notification?.requestPermission?.();
        if (permission !== "granted") {
          toast.info("Notifications are blocked", {
            description:
              "Allow notifications for PostHog Code in your system settings.",
          });
          return;
        }
      }
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "desktop_notifications",
        new_value: checked,
        old_value: desktopNotifications,
      });
      setDesktopNotifications(checked);
    },
    [desktopNotifications, setDesktopNotifications],
  );

  const handleCompletionSoundChange = useCallback(
    (value: CompletionSound) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "completion_sound",
        new_value: value,
        old_value: completionSound,
      });
      setCompletionSound(value);
    },
    [completionSound, setCompletionSound],
  );

  const resetToDefaults = useCallback(() => {
    setDesktopNotifications(NOTIFICATION_DEFAULTS.desktopNotifications);
    setDockBadgeNotifications(NOTIFICATION_DEFAULTS.dockBadgeNotifications);
    setDockBounceNotifications(NOTIFICATION_DEFAULTS.dockBounceNotifications);
    setCompletionSound(NOTIFICATION_DEFAULTS.completionSound);
    setCompletionVolume(NOTIFICATION_DEFAULTS.completionVolume);
    toast.success("Notification settings reset to defaults");
  }, [
    setDesktopNotifications,
    setDockBadgeNotifications,
    setDockBounceNotifications,
    setCompletionSound,
    setCompletionVolume,
  ]);

  return (
    <Flex direction="column">
      {notificationsDenied && (
        <Text color="yellow" className="mb-2 text-[13px]">
          Notifications are blocked in your system settings. Enable
          notifications for PostHog Code to receive them.
        </Text>
      )}

      <Flex align="center" justify="between" className="mb-2 pt-2">
        <Text className="font-medium text-sm">Defaults</Text>
        <Button variant="soft" size="1" onClick={resetToDefaults}>
          Reset to defaults
        </Button>
      </Flex>

      <SettingRow
        label="Push notifications"
        description="Receive a native OS notification when the app is in the background and an agent finishes or needs your input"
      >
        <Switch
          checked={desktopNotifications}
          onCheckedChange={handleDesktopNotificationsChange}
          disabled={notificationsDenied}
          size="1"
        />
      </SettingRow>

      <SettingRow
        label="Dock badge"
        description="Display a badge on the dock icon when the agent finishes a task or needs your input"
      >
        <Switch
          checked={dockBadgeNotifications}
          onCheckedChange={setDockBadgeNotifications}
          size="1"
        />
      </SettingRow>

      <SettingRow
        label="Bounce dock icon"
        description="Bounce the dock icon when the agent finishes a task or needs your input"
      >
        <Switch
          checked={dockBounceNotifications}
          onCheckedChange={setDockBounceNotifications}
          size="1"
        />
      </SettingRow>

      <SettingRow
        label="Sound effect"
        description="Play a sound when the agent finishes a task or needs your input"
        noBorder={completionSound === "none"}
      >
        <Flex align="center" gap="2">
          <Select.Root
            value={completionSound}
            onValueChange={(value) =>
              handleCompletionSoundChange(value as CompletionSound)
            }
            size="1"
          >
            <Select.Trigger className="min-w-[100px]" />
            <Select.Content>
              <Select.Item value="none">None</Select.Item>
              <Select.Item value="guitar">Guitar solo</Select.Item>
              <Select.Item value="danilo">I'm ready</Select.Item>
              <Select.Item value="revi">Cute noise</Select.Item>
              <Select.Item value="meep">Meep</Select.Item>
              <Select.Item value="meep-smol">Meep (smol)</Select.Item>
              <Select.Item value="bubbles">Bubbles</Select.Item>
              <Select.Item value="drop">Drop</Select.Item>
              <Select.Item value="knock">Knock</Select.Item>
              <Select.Item value="ring">Ring</Select.Item>
              <Select.Item value="shoot">Shoot</Select.Item>
              <Select.Item value="slide">Slide</Select.Item>
              <Select.Item value="switch">Switch</Select.Item>
              <Select.Item value="wilhelm">Wilhelm scream</Select.Item>
              <Select.Item value="icq">ICQ</Select.Item>
            </Select.Content>
          </Select.Root>
          {completionSound !== "none" && (
            <Button
              variant="soft"
              size="1"
              onClick={() =>
                playCompletionSound(completionSound, completionVolume)
              }
            >
              Test
            </Button>
          )}
        </Flex>
      </SettingRow>

      {completionSound !== "none" && (
        <SettingRow label="Sound volume" noBorder>
          <Flex align="center" gap="3">
            <Slider
              value={[completionVolume]}
              onValueChange={([value]) => setCompletionVolume(value)}
              min={0}
              max={100}
              step={1}
              size="1"
              className="w-[120px]"
            />
            <Text color="gray" className="text-[13px]">
              {completionVolume}%
            </Text>
          </Flex>
        </SettingRow>
      )}

      <NotificationTestHarness
        bus={bus}
        notifications={notifications}
        deepLinkTask={deepLinkTask}
        canvasEnabled={canvasEnabled}
      />
    </Flex>
  );
}

// Fires each delivery channel directly (bypassing the focus-aware routing, since
// you're focused on Settings) so each tier can be verified in isolation.
function NotificationTestHarness({
  bus,
  notifications,
  deepLinkTask,
  canvasEnabled,
}: {
  bus: NotificationBus | null;
  notifications: INotifications | null;
  deepLinkTask: Task | undefined;
  canvasEnabled: boolean;
}) {
  const nativeUnavailable = !notifications;

  const testToast = () =>
    bus?.notify({
      body: "Test notification",
      toast: {
        level: "success",
        description: "This is what an in-app toast looks like.",
      },
    });

  // A toast carrying a target renders a "View" action that deep-links — the
  // in-app counterpart of clicking a native notification.
  const testToastDeepLink = () => {
    if (!bus || !deepLinkTask) return;
    bus.notify({
      body: `"${deepLinkTask.title}"`,
      target: { kind: "task", taskId: deepLinkTask.id },
      toast: {
        level: "success",
        description: "Click “View task” to deep-link to it.",
      },
    });
  };

  const testNative = () =>
    notifications?.notify({
      title: "PostHog Code",
      body: "This is a native OS notification.",
      silent: false,
    });

  const testNativeDeepLink = () => {
    if (!notifications || !deepLinkTask) return;
    notifications.notify({
      title: "PostHog Code",
      body: `Click to open "${deepLinkTask.title}"`,
      silent: false,
      target: { kind: "task", taskId: deepLinkTask.id },
    });
  };

  return (
    <>
      <Text className="mt-4 mb-1 block border-gray-6 border-t pt-4 font-medium text-sm">
        Test
      </Text>
      <Text color="gray" className="mb-1 text-[13px]">
        Fire each delivery channel directly to check it works end to end.
        {nativeUnavailable
          ? " Native notifications aren't available on this host."
          : ""}
      </Text>

      <SettingRow
        label="In-app toast"
        description={`Shows an in-app toast — the tier used when the app is focused but you're not on the relevant task${canvasEnabled ? " or canvas" : ""}.`}
      >
        <Button variant="soft" size="1" onClick={testToast} disabled={!bus}>
          Send
        </Button>
      </SettingRow>

      <SettingRow
        label="Deep-link toast"
        description={
          deepLinkTask
            ? `Toast with a "View" action that opens "${deepLinkTask.title}".`
            : "Run a task first to test deep-linking from a toast."
        }
      >
        <Button
          variant="soft"
          size="1"
          onClick={testToastDeepLink}
          disabled={!bus || !deepLinkTask}
        >
          Send
        </Button>
      </SettingRow>

      <SettingRow
        label="Native OS notification"
        description="Shows a system notification — the tier used when the app is in the background."
      >
        <Button
          variant="soft"
          size="1"
          onClick={testNative}
          disabled={nativeUnavailable}
        >
          Send
        </Button>
      </SettingRow>

      <SettingRow
        label="Deep-link notification"
        description={
          deepLinkTask
            ? `Fires a native notification that opens "${deepLinkTask.title}" when clicked.`
            : "Run a task first to test deep-linking from a notification."
        }
      >
        <Button
          variant="soft"
          size="1"
          onClick={testNativeDeepLink}
          disabled={nativeUnavailable || !deepLinkTask}
        >
          Send
        </Button>
      </SettingRow>

      <SettingRow
        label="Dock badge"
        description="Adds the unread dot to the dock icon (clears on next focus)."
      >
        <Button
          variant="soft"
          size="1"
          onClick={() => notifications?.showUnreadIndicator()}
          disabled={nativeUnavailable}
        >
          Show
        </Button>
      </SettingRow>

      <SettingRow
        label="Dock bounce"
        description="Bounces the dock icon once to request attention."
        noBorder
      >
        <Button
          variant="soft"
          size="1"
          onClick={() => notifications?.requestAttention()}
          disabled={nativeUnavailable}
        >
          Bounce
        </Button>
      </SettingRow>
    </>
  );
}
