import { HashIcon } from "@phosphor-icons/react";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteGroup,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteLabel,
  AutocompleteList,
  AutocompleteStatus,
  Dialog,
  DialogContent,
} from "@posthog/quill";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import {
  ANALYTICS_EVENTS,
  type CommandMenuAction,
} from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useTaskChannelMap } from "@posthog/ui/features/canvas/hooks/useTaskChannelMap";
import { useReviewNavigationStore } from "@posthog/ui/features/code-review/reviewNavigationStore";
import { CommandKeyHints } from "@posthog/ui/features/command/CommandKeyHints";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useFolders } from "@posthog/ui/features/folders/useFolders";
import {
  closeSettings,
  openSettings,
} from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useTaskPrStatus } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import {
  navigateToChannel,
  navigateToChannelTask,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { openTask, openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { useThemeStore } from "@posthog/ui/shell/themeStore";
import {
  DesktopIcon,
  FileTextIcon,
  GearIcon,
  HomeIcon,
  MoonIcon,
  SunIcon,
  ViewVerticalIcon,
} from "@radix-ui/react-icons";
import { useCallback, useEffect, useMemo, useState } from "react";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Command = {
  id: string;
  label: string;
  /** Muted trailing detail shown after a middot, e.g. a task's channel. */
  detail?: string;
  keywords?: string;
  icon: React.ReactNode;
  action: CommandMenuAction;
  onRun: () => void;
};

type CommandSection = { label: string; items: Command[] };

/**
 * Task icon for the command palette. Renders the same shared `TaskIcon` as
 * the sidebar — cloud run status, PR/branch status, etc. — deriving its
 * inputs from the raw task and a per-task PR-status query.
 */
function TaskCommandIcon({ task }: { task: Task }) {
  const { prState, hasDiff } = useTaskPrStatus({
    id: task.id,
    cloudPrUrl: null,
    taskRunEnvironment: task.latest_run?.environment,
  });
  const stateSlackThreadUrl = (
    task.latest_run?.state as { slack_thread_url?: unknown } | undefined
  )?.slack_thread_url;
  const slackThreadUrl =
    typeof stateSlackThreadUrl === "string" ? stateSlackThreadUrl : undefined;
  return (
    <TaskIcon
      workspaceMode={task.latest_run?.environment}
      taskRunStatus={task.latest_run?.status}
      originProduct={task.origin_product}
      slackThreadUrl={slackThreadUrl}
      prState={prState}
      hasDiff={hasDiff}
    />
  );
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const openSettingsDialog = openSettings;
  const closeSettingsDialog = closeSettings;
  const { folders } = useFolders();
  // Channels (and the task→channel detail) are a Project Bluebird feature. Gate
  // the channel fetches behind the flag so they never reach ungated users.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const { channels } = useChannels({ enabled: bluebirdEnabled });
  const taskChannelMap = useTaskChannelMap(channels, {
    enabled: open && bluebirdEnabled,
  });
  const { theme, setTheme } = useThemeStore();
  const toggleLeftSidebar = useSidebarStore((state) => state.toggle);
  const view = useAppView();
  const setReviewMode = useReviewNavigationStore(
    (state) => state.setReviewMode,
  );
  const getReviewMode = useReviewNavigationStore(
    (state) => state.getReviewMode,
  );
  const { data: tasks = [] } = useTasks();
  const [query, setQuery] = useState("");
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) =>
      setSystemPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const openReviewPanel = useCallback(() => {
    const taskId = view.type === "task-detail" ? view.taskId : undefined;
    if (!taskId) return;
    const mode = getReviewMode(taskId);
    if (mode === "closed") {
      setReviewMode(taskId, "split");
    }
  }, [view, getReviewMode, setReviewMode]);

  useEffect(() => {
    if (open) {
      track(ANALYTICS_EVENTS.COMMAND_MENU_OPENED);
    } else {
      setQuery("");
    }
  }, [open]);

  const themeOptions = useMemo<Command[]>(() => {
    const options: Command[] = [];
    if (theme !== "light") {
      options.push({
        id: "switch-theme-light",
        label: "Switch to light mode",
        keywords: "theme appearance",
        icon: <SunIcon className="h-3 w-3 text-gray-11" />,
        action: "toggle-theme",
        onRun: () => setTheme("light"),
      });
    }
    if (theme !== "dark") {
      options.push({
        id: "switch-theme-dark",
        label: "Switch to dark mode",
        keywords: "theme appearance",
        icon: <MoonIcon className="h-3 w-3 text-gray-11" />,
        action: "toggle-theme",
        onRun: () => setTheme("dark"),
      });
    }
    const systemMatchesCurrent =
      (theme === "dark" && systemPrefersDark) ||
      (theme === "light" && !systemPrefersDark);
    if (theme !== "system" && !systemMatchesCurrent) {
      options.push({
        id: "switch-theme-system",
        label: "Switch to system theme",
        keywords: "theme appearance auto",
        icon: <DesktopIcon className="h-3 w-3 text-gray-11" />,
        action: "toggle-theme",
        onRun: () => setTheme("system"),
      });
    }
    return options;
  }, [theme, setTheme, systemPrefersDark]);

  const commandSections = useMemo<CommandSection[]>(() => {
    const navigation: Command[] = [
      {
        id: "home",
        label: "Home",
        icon: <HomeIcon className="h-3 w-3 text-gray-11" />,
        action: "home",
        onRun: () => {
          closeSettingsDialog();
          openTaskInput();
        },
      },
      {
        id: "settings",
        label: "Settings",
        icon: <GearIcon className="h-3 w-3 text-gray-11" />,
        action: "settings",
        onRun: () => openSettingsDialog(),
      },
    ];

    const actions: Command[] = [
      ...themeOptions,
      {
        id: "toggle-left-sidebar",
        label: "Toggle left sidebar",
        icon: <ViewVerticalIcon className="h-3 w-3 text-gray-11" />,
        action: "toggle-left-sidebar",
        onRun: toggleLeftSidebar,
      },
      {
        id: "open-review-panel",
        label: "Open review panel",
        icon: <ViewVerticalIcon className="h-3 w-3 rotate-180 text-gray-11" />,
        action: "open-review-panel",
        onRun: openReviewPanel,
      },
      {
        id: "new-task",
        label: "New task",
        keywords: "create",
        icon: <FileTextIcon className="h-3 w-3 text-gray-11" />,
        action: "new-task",
        onRun: () => {
          closeSettingsDialog();
          openTaskInput();
        },
      },
    ];

    const out: CommandSection[] = [
      { label: "Navigation", items: navigation },
      { label: "Actions", items: actions },
    ];

    if (folders.length > 0) {
      out.push({
        label: "New task in folder",
        items: folders.map((folder) => ({
          id: `new-task-folder-${folder.id}`,
          label: `New task in ${folder.name}`,
          keywords: folder.path,
          icon: <FileTextIcon className="h-3 w-3 text-gray-11" />,
          action: "new-task",
          onRun: () => {
            closeSettingsDialog();
            openTaskInput(folder.id);
          },
        })),
      });
    }

    return out;
  }, [
    folders,
    themeOptions,
    openSettingsDialog,
    closeSettingsDialog,
    toggleLeftSidebar,
    openReviewPanel,
  ]);

  const taskSections = useMemo<CommandSection[]>(() => {
    if (tasks.length === 0) return [];
    return [
      {
        label: "Tasks",
        items: tasks.map((task) => {
          const channel = taskChannelMap.get(task.id);
          return {
            id: `task-${task.id}`,
            label: task.title,
            detail: channel?.name,
            // Include the channel name so searching it surfaces filed tasks.
            keywords: channel?.name,
            icon: <TaskCommandIcon task={task} />,
            action: "open-task" as CommandMenuAction,
            onRun: () => {
              closeSettingsDialog();
              // Bluebird: a task filed to a channel opens in the channel-
              // organized view under /website, keeping the channels chrome.
              // Otherwise fall back to the /code task detail.
              if (bluebirdEnabled && channel) {
                navigateToChannelTask(channel.id, task.id);
              } else {
                void openTask(task);
              }
            },
          };
        }),
      },
    ];
  }, [tasks, taskChannelMap, bluebirdEnabled, closeSettingsDialog]);

  const channelSections = useMemo<CommandSection[]>(() => {
    if (channels.length === 0) return [];
    return [
      {
        label: "Channels",
        items: channels.map((channel) => ({
          id: `channel-${channel.id}`,
          label: channel.name,
          keywords: "channel",
          icon: <HashIcon size={12} className="text-gray-11" />,
          action: "open-channel" as CommandMenuAction,
          onRun: () => {
            closeSettingsDialog();
            navigateToChannel(channel.id);
          },
        })),
      },
    ];
  }, [channels, closeSettingsDialog]);

  // Commands, channels, and tasks share a single filterable list.
  const sections = useMemo(
    () => [...commandSections, ...channelSections, ...taskSections],
    [commandSections, channelSections, taskSections],
  );

  const allCommands = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections],
  );

  const handleSelect = (id: string | null): void => {
    if (id === null) return;
    const cmd = allCommands.find((c) => c.id === id);
    if (!cmd) return;
    track(ANALYTICS_EVENTS.COMMAND_MENU_ACTION, { action_type: cmd.action });
    cmd.onRun();
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[720px] max-w-[90vw] gap-0 p-0"
        showCloseButton={false}
      >
        <Autocomplete<Command>
          inline
          defaultOpen
          items={sections}
          value={query}
          autoHighlight="always"
          onValueChange={(val, eventDetails) => {
            if (eventDetails.reason !== "input-change") return;
            if (typeof val === "string") {
              setQuery(val);
            }
          }}
          filter={(cmd, q) => {
            if (!q) return true;
            const haystack = `${cmd.label} ${cmd.keywords ?? ""}`.toLowerCase();
            return haystack.includes(q.toLowerCase());
          }}
        >
          <AutocompleteInput
            placeholder={
              bluebirdEnabled
                ? "Search commands, channels, and tasks…"
                : "Search commands and tasks…"
            }
            autoFocus
            showClear
          />
          <AutocompleteStatus
            emptyContent={
              <span>
                No results for <strong>"{query}"</strong>
              </span>
            }
          />
          <AutocompleteList className="max-h-[60vh]">
            {(section: CommandSection) => (
              <AutocompleteGroup key={section.label} items={section.items}>
                <AutocompleteLabel>{section.label}</AutocompleteLabel>
                <AutocompleteCollection>
                  {(cmd: Command) => (
                    <AutocompleteItem
                      key={cmd.id}
                      value={cmd.id}
                      onClick={() => handleSelect(cmd.id)}
                      // Long task names wrap instead of truncating, so the
                      // item must grow: min-height, not a fixed height.
                      className="h-auto! min-h-7 py-1.5 text-left"
                    >
                      {cmd.icon}
                      <span className="wrap-break-word min-w-0 whitespace-normal">
                        {cmd.label}
                      </span>
                      {cmd.detail && (
                        <span className="shrink-0 text-gray-9">
                          · #{cmd.detail}
                        </span>
                      )}
                    </AutocompleteItem>
                  )}
                </AutocompleteCollection>
              </AutocompleteGroup>
            )}
          </AutocompleteList>
        </Autocomplete>
        <CommandKeyHints />
      </DialogContent>
    </Dialog>
  );
}
