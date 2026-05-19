import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { SettingRow } from "@features/settings/components/SettingRow";
import {
  type AutoConvertLongText,
  type CompletionSound,
  type DefaultInitialTaskMode,
  type DiffOpenMode,
  type SendMessagesWith,
  useSettingsStore,
} from "@features/settings/stores/settingsStore";
import { ArrowSquareOut } from "@phosphor-icons/react";
import {
  Button,
  Flex,
  Link,
  Select,
  Slider,
  Switch,
  Text,
} from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import type { ThemePreference } from "@stores/themeStore";
import { useThemeStore } from "@stores/themeStore";
import { useMutation, useQuery } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { playCompletionSound } from "@utils/sounds";
import { getPostHogUrl } from "@utils/urls";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

export function GeneralSettings() {
  const trpcReact = useTRPC();
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);

  // Appearance state
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  // Power state
  const { preventSleepWhileRunning, setPreventSleepWhileRunning } =
    useSettingsStore();
  const { data: serverPreventSleep } = useQuery(
    trpcReact.sleep.getEnabled.queryOptions(),
  );
  const preventSleepMutation = useMutation(
    trpcReact.sleep.setEnabled.mutationOptions(),
  );

  useEffect(() => {
    if (serverPreventSleep !== undefined) {
      setPreventSleepWhileRunning(serverPreventSleep);
    }
  }, [serverPreventSleep, setPreventSleepWhileRunning]);

  const handlePreventSleepChange = useCallback(
    (checked: boolean) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "prevent_sleep_while_running",
        new_value: checked,
        old_value: !checked,
      });
      setPreventSleepWhileRunning(checked);
      preventSleepMutation.mutate({ enabled: checked });
    },
    [setPreventSleepWhileRunning, preventSleepMutation],
  );

  // Chat state
  const {
    desktopNotifications,
    dockBadgeNotifications,
    dockBounceNotifications,
    completionSound,
    completionVolume,
    autoConvertLongText,
    defaultInitialTaskMode,
    diffOpenMode,
    sendMessagesWith,
    hedgehogMode,
    setDesktopNotifications,
    setDockBadgeNotifications,
    setDockBounceNotifications,
    setCompletionSound,
    setCompletionVolume,
    setAutoConvertLongText,
    setDefaultInitialTaskMode,
    setDiffOpenMode,
    setSendMessagesWith,
    setHedgehogMode,
  } = useSettingsStore();

  // Sync toggle off if the user denied notification permission at the OS level
  useEffect(() => {
    if (window.Notification?.permission === "denied" && desktopNotifications) {
      setDesktopNotifications(false);
    }
  }, [desktopNotifications, setDesktopNotifications]);

  const notificationPermission = window.Notification?.permission;
  const notificationsDenied = notificationPermission === "denied";

  const handleDesktopNotificationsChange = useCallback(
    async (checked: boolean) => {
      if (checked) {
        const permission = await window.Notification?.requestPermission?.();
        if (permission !== "granted") {
          toast.info("Notifications are blocked", {
            description:
              "Allow PostHog Code notifications in System Settings > Notifications",
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

  // Appearance handlers
  const handleThemeChange = useCallback(
    (value: ThemePreference) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "theme",
        new_value: value,
        old_value: theme,
      });
      setTheme(value);
    },
    [theme, setTheme],
  );

  // Chat handlers
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

  const handleTestSound = useCallback(() => {
    playCompletionSound(completionSound, completionVolume);
  }, [completionSound, completionVolume]);

  const handleAutoConvertLongTextChange = useCallback(
    (value: AutoConvertLongText) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "auto_convert_long_text",
        new_value: value,
        old_value: autoConvertLongText,
      });
      setAutoConvertLongText(value);
    },
    [autoConvertLongText, setAutoConvertLongText],
  );

  const handleDiffOpenModeChange = useCallback(
    (value: DiffOpenMode) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "diff_open_mode",
        new_value: value,
        old_value: diffOpenMode,
      });
      setDiffOpenMode(value);
    },
    [diffOpenMode, setDiffOpenMode],
  );

  const handleDefaultInitialTaskModeChange = useCallback(
    (value: DefaultInitialTaskMode) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "default_initial_task_mode",
        new_value: value,
        old_value: defaultInitialTaskMode,
      });
      setDefaultInitialTaskMode(value);
    },
    [defaultInitialTaskMode, setDefaultInitialTaskMode],
  );

  const handleSendMessagesWithChange = useCallback(
    (value: SendMessagesWith) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "send_messages_with",
        new_value: value,
        old_value: sendMessagesWith,
      });
      setSendMessagesWith(value);
    },
    [sendMessagesWith, setSendMessagesWith],
  );

  const handleHedgehogModeChange = useCallback(
    (checked: boolean) => {
      track(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: "hedgehog_mode",
        new_value: checked,
        old_value: hedgehogMode,
      });
      setHedgehogMode(checked);
    },
    [hedgehogMode, setHedgehogMode],
  );

  const accountUrl = getPostHogUrl("/settings/user", cloudRegion);

  return (
    <Flex direction="column">
      {isAuthenticated && (
        <SettingRow
          label="Manage Account"
          description="Manage your account and billing on PostHog"
        >
          <Button
            size="1"
            variant="outline"
            disabled={!accountUrl}
            onClick={() => {
              if (accountUrl) window.open(accountUrl, "_blank");
            }}
          >
            Manage
            <ArrowSquareOut size={12} />
          </Button>
        </SettingRow>
      )}

      {/* Appearance */}
      <Text className="mb-2 pt-4 font-medium text-sm">Appearance</Text>

      <SettingRow
        label="Theme"
        description="Choose light, dark, or follow your system preference"
      >
        <Select.Root
          value={theme}
          onValueChange={(v) => handleThemeChange(v as ThemePreference)}
          size="1"
        >
          <Select.Trigger className="min-w-[100px]" />
          <Select.Content>
            <Select.Item value="light">Light</Select.Item>
            <Select.Item value="dark">Dark</Select.Item>
            <Select.Item value="system">System</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingRow>

      {/* Notifications */}
      <Text className="mb-2 block border-gray-6 border-t pt-4 font-medium text-sm">
        Notifications
      </Text>

      {notificationsDenied && (
        <Text color="yellow" className="mb-2 text-[13px]">
          Notifications are blocked by macOS. To enable them, open System
          Settings &gt; Notifications &gt; PostHog Code and turn on Allow
          Notifications.
        </Text>
      )}

      <SettingRow
        label="Push notifications"
        description="Receive a desktop notification when the agent finishes a task or needs your input"
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
              <Select.Item value="bubbles">Bubbles</Select.Item>
              <Select.Item value="drop">Drop</Select.Item>
              <Select.Item value="knock">Knock</Select.Item>
              <Select.Item value="ring">Ring</Select.Item>
              <Select.Item value="shoot">Shoot</Select.Item>
              <Select.Item value="slide">Slide</Select.Item>
              <Select.Item value="switch">Switch</Select.Item>
              <Select.Item value="wilhelm">Wilhelm scream</Select.Item>
            </Select.Content>
          </Select.Root>
          {completionSound !== "none" && (
            <Button variant="soft" size="1" onClick={handleTestSound}>
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

      {/* Input */}
      <Text className="mb-2 block border-gray-6 border-t pt-4 font-medium text-sm">
        Input
      </Text>

      <SettingRow
        label="Initial task mode"
        description="Choose whether new tasks always start in Plan mode or remember your last-used mode"
      >
        <Select.Root
          value={defaultInitialTaskMode}
          onValueChange={(value) =>
            handleDefaultInitialTaskModeChange(value as DefaultInitialTaskMode)
          }
          size="1"
        >
          <Select.Trigger className="min-w-[100px]" />
          <Select.Content>
            <Select.Item value="plan">Plan</Select.Item>
            <Select.Item value="last_used">Last used</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingRow>

      <SettingRow
        label="Send messages with"
        description="Choose which key combination sends messages. Use Shift+Enter for new lines"
      >
        <Select.Root
          value={sendMessagesWith}
          onValueChange={(value) =>
            handleSendMessagesWithChange(value as SendMessagesWith)
          }
          size="1"
        >
          <Select.Trigger className="min-w-[100px]" />
          <Select.Content>
            <Select.Item value="enter">Enter</Select.Item>
            <Select.Item value="cmd+enter">⌘ Enter</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingRow>

      <SettingRow
        label="Auto-convert long text"
        description="Automatically convert pasted text over this length into an attachment"
      >
        <Select.Root
          value={autoConvertLongText}
          onValueChange={(value) =>
            handleAutoConvertLongTextChange(value as AutoConvertLongText)
          }
          size="1"
        >
          <Select.Trigger className="min-w-[120px]" />
          <Select.Content>
            <Select.Item value="off">Off</Select.Item>
            <Select.Item value="1000">1,000 chars</Select.Item>
            <Select.Item value="2500">2,500 chars</Select.Item>
            <Select.Item value="5000">5,000 chars</Select.Item>
            <Select.Item value="10000">10,000 chars</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingRow>

      {/* Editor */}
      <Text className="mb-2 block border-gray-6 border-t pt-4 font-medium text-sm">
        Editor
      </Text>

      <SettingRow
        label="Open diffs in"
        description="Choose how file diffs open when clicking a changed file"
        noBorder
      >
        <Select.Root
          value={diffOpenMode}
          onValueChange={(value) =>
            handleDiffOpenModeChange(value as DiffOpenMode)
          }
          size="1"
        >
          <Select.Trigger className="min-w-[140px]" />
          <Select.Content>
            <Select.Item value="auto">Auto</Select.Item>
            <Select.Item value="split">Split pane</Select.Item>
            <Select.Item value="same-pane">Same pane</Select.Item>
            <Select.Item value="last-active-pane">Last active pane</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingRow>

      {/* Power */}
      <Text className="mb-2 block border-gray-6 border-t pt-4 font-medium text-sm">
        Power
      </Text>

      <SettingRow
        label="Keep awake while agents work"
        description="Prevent your computer from sleeping while the agent is running a task"
        noBorder
      >
        <Switch
          checked={preventSleepWhileRunning}
          onCheckedChange={handlePreventSleepChange}
          size="1"
        />
      </SettingRow>

      {/* Fun */}
      <Text className="mb-2 block border-gray-6 border-t pt-4 font-medium text-sm">
        Fun
      </Text>

      <SettingRow
        label="Hedgehog mode"
        description={<HedgehogDescription />}
        noBorder
      >
        <Switch
          checked={hedgehogMode}
          onCheckedChange={handleHedgehogModeChange}
          size="1"
        />
      </SettingRow>
    </Flex>
  );
}

function HedgehogDescription() {
  const projectId = useAuthStateValue((state) => state.projectId);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);

  const customizeUrl = projectId
    ? getPostHogUrl(
        `/project/${projectId}/settings/user-customization`,
        cloudRegion,
      )
    : null;

  return (
    <Flex direction="column" gap="1">
      <Text color="gray" className="text-[13px]">
        Release a hedgehog buddy to walk around your screen. It might take a few
        seconds to appear.
      </Text>
      {customizeUrl && (
        <Text color="gray" className="text-[13px]">
          <Link href={customizeUrl} target="_blank">
            Customize your hedgehog
          </Link>
        </Text>
      )}
    </Flex>
  );
}
