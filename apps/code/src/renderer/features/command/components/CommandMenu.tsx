import { useReviewNavigationStore } from "@features/code-review/stores/reviewNavigationStore";
import { CommandKeyHints } from "@features/command/components/CommandKeyHints";
import { useFolders } from "@features/folders/hooks/useFolders";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { useSidebarStore } from "@features/sidebar/stores/sidebarStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@posthog/quill";
import {
  DesktopIcon,
  FileTextIcon,
  GearIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SunIcon,
  ViewVerticalIcon,
} from "@radix-ui/react-icons";
import {
  ANALYTICS_EVENTS,
  type CommandMenuAction,
} from "@shared/types/analytics";
import {
  type CommandMenuScope,
  useCommandMenuStore,
} from "@stores/commandMenuStore";
import { useNavigationStore } from "@stores/navigationStore";
import { useThemeStore } from "@stores/themeStore";
import { track } from "@utils/analytics";
import { useCallback, useEffect, useMemo, useState } from "react";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Command = {
  id: string;
  label: string;
  keywords?: string;
  icon: React.ReactNode;
  action: CommandMenuAction;
  onRun: () => void;
};

type CommandSection = { label: string; items: Command[] };

const SCOPE_LABELS: Record<CommandMenuScope, string> = {
  commands: "Commands",
  tasks: "Tasks",
};

const SCOPE_PLACEHOLDERS: Record<CommandMenuScope, string> = {
  commands: "Type a command…",
  tasks: "Search tasks…",
};

/** Scope picker rendered inline at the end of the command input. */
function ScopeSelect({
  scope,
  onScopeChange,
}: {
  scope: CommandMenuScope;
  onScopeChange: (scope: CommandMenuScope) => void;
}) {
  return (
    <Select
      value={scope}
      onValueChange={(value) => {
        if (value === "commands" || value === "tasks") onScopeChange(value);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Search scope"
        className="border-0 bg-transparent shadow-none hover:bg-fill-hover"
      >
        <SelectValue>
          {(value) => SCOPE_LABELS[(value as CommandMenuScope) ?? "commands"]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="commands">Commands</SelectItem>
          <SelectItem value="tasks">Tasks</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const { navigateToTaskInput, navigateToTask } = useNavigationStore();
  const openSettingsDialog = useSettingsDialogStore((state) => state.open);
  const closeSettingsDialog = useSettingsDialogStore((state) => state.close);
  const { folders } = useFolders();
  const { theme, setTheme } = useThemeStore();
  const toggleLeftSidebar = useSidebarStore((state) => state.toggle);
  const view = useNavigationStore((state) => state.view);
  const setReviewMode = useReviewNavigationStore(
    (state) => state.setReviewMode,
  );
  const getReviewMode = useReviewNavigationStore(
    (state) => state.getReviewMode,
  );
  const scope = useCommandMenuStore((state) => state.scope);
  const setScope = useCommandMenuStore((state) => state.setScope);
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
    const taskId = view.type === "task-detail" ? view.data?.id : undefined;
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

  // Clear the query whenever the scope flips so stale text doesn't carry over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on scope change only
  useEffect(() => {
    setQuery("");
  }, [scope]);

  const cycleScope = useCallback(() => {
    setScope(scope === "commands" ? "tasks" : "commands");
  }, [scope, setScope]);

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
          navigateToTaskInput();
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
          navigateToTaskInput();
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
            navigateToTaskInput(folder.id);
          },
        })),
      });
    }

    return out;
  }, [
    folders,
    themeOptions,
    navigateToTaskInput,
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
        items: tasks.map((task) => ({
          id: `task-${task.id}`,
          label: task.title,
          icon: <FileTextIcon className="h-3 w-3 text-gray-11" />,
          action: "open-task" as CommandMenuAction,
          onRun: () => {
            closeSettingsDialog();
            navigateToTask(task);
          },
        })),
      },
    ];
  }, [tasks, navigateToTask, closeSettingsDialog]);

  const sections = scope === "tasks" ? taskSections : commandSections;

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
            placeholder={SCOPE_PLACEHOLDERS[scope]}
            autoFocus
            showClear
            onKeyDown={(event) => {
              // Tab cycles between the Commands / Tasks scopes instead of
              // moving focus out of the input.
              if (event.key === "Tab") {
                event.preventDefault();
                event.stopPropagation();
                cycleScope();
              }
            }}
          >
            <ScopeSelect scope={scope} onScopeChange={setScope} />
          </AutocompleteInput>
          <AutocompleteStatus
            emptyContent={
              scope === "tasks" ? (
                <span className="flex items-center justify-center gap-1.5">
                  <MagnifyingGlassIcon className="h-3 w-3" />
                  No tasks match <strong>"{query}"</strong>
                </span>
              ) : (
                <span>
                  No commands match <strong>"{query}"</strong>
                </span>
              )
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
                    >
                      {cmd.icon}
                      {cmd.label}
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
