import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useLogoutMutation } from "@features/auth/hooks/authMutations";
import {
  useAuthStateValue,
  useCurrentUser,
} from "@features/auth/hooks/authQueries";
import {
  type SettingsCategory,
  useSettingsDialogStore,
} from "@features/settings/stores/settingsDialogStore";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useSeat } from "@hooks/useSeat";
import {
  ArrowLeft,
  ArrowsClockwise,
  CaretRight,
  Code,
  CreditCard,
  Cube,
  Folder,
  GearSix,
  GithubLogo,
  Keyboard,
  Palette,
  SignOut,
  SlackLogo,
  TrafficSignal,
  TreeStructure,
  Wrench,
} from "@phosphor-icons/react";
import { Avatar, Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { BILLING_FLAG } from "@shared/constants";
import { type ReactNode, useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AdvancedSettings } from "./sections/AdvancedSettings";
import { ClaudeCodeSettings } from "./sections/ClaudeCodeSettings";
import { EnvironmentsSettings } from "./sections/environments/EnvironmentsSettings";
import { GeneralSettings } from "./sections/GeneralSettings";
import { GitHubSettings } from "./sections/GitHubSettings";
import { PersonalizationSettings } from "./sections/PersonalizationSettings";
import { PlanUsageSettings } from "./sections/PlanUsageSettings";
import { ShortcutsSettings } from "./sections/ShortcutsSettings";
import { SignalSourcesSettings } from "./sections/SignalSourcesSettings";
import { SlackSettings } from "./sections/SlackSettings";
import { UpdatesSettings } from "./sections/UpdatesSettings";
import { WorkspacesSettings } from "./sections/WorkspacesSettings";
import { WorktreesSettings } from "./sections/worktrees/WorktreesSettings";

interface SidebarItem {
  id: SettingsCategory;
  label: string;
  icon: ReactNode;
  hasChevron?: boolean;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "general", label: "General", icon: <GearSix size={16} /> },
  { id: "plan-usage", label: "Plan & usage", icon: <CreditCard size={16} /> },
  { id: "workspaces", label: "Workspaces", icon: <Folder size={16} /> },
  { id: "worktrees", label: "Worktrees", icon: <TreeStructure size={16} /> },
  {
    id: "environments",
    label: "Environments",
    icon: <Cube size={16} />,
  },
  {
    id: "personalization",
    label: "Personalization",
    icon: <Palette size={16} />,
  },
  { id: "claude-code", label: "Claude Code", icon: <Code size={16} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
  { id: "github", label: "GitHub", icon: <GithubLogo size={16} /> },
  { id: "slack", label: "Slack", icon: <SlackLogo size={16} /> },

  {
    id: "signals",
    label: "Signals",
    icon: <TrafficSignal size={16} />,
  },
  { id: "updates", label: "Updates", icon: <ArrowsClockwise size={16} /> },
  { id: "advanced", label: "Advanced", icon: <Wrench size={16} /> },
];

const CATEGORY_TITLES: Record<SettingsCategory, string> = {
  general: "General",
  "plan-usage": "Plan & usage",
  workspaces: "Workspaces",
  worktrees: "Worktrees",
  environments: "Environments",
  "cloud-environments": "Environments",
  personalization: "Personalization",
  "claude-code": "Claude Code",
  shortcuts: "Shortcuts",
  github: "GitHub",
  slack: "Slack integration",

  signals: "Signals",
  updates: "Updates",
  advanced: "Advanced",
};

const CATEGORY_COMPONENTS: Record<SettingsCategory, React.ComponentType> = {
  general: GeneralSettings,
  "plan-usage": PlanUsageSettings,
  workspaces: WorkspacesSettings,
  worktrees: WorktreesSettings,
  environments: EnvironmentsSettings,
  "cloud-environments": EnvironmentsSettings,
  personalization: PersonalizationSettings,
  "claude-code": ClaudeCodeSettings,
  shortcuts: ShortcutsSettings,
  github: GitHubSettings,
  slack: SlackSettings,

  signals: SignalSourcesSettings,
  updates: UpdatesSettings,
  advanced: AdvancedSettings,
};

export function SettingsDialog() {
  const { isOpen, activeCategory, close, setCategory, formMode } =
    useSettingsDialogStore();
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const client = useOptionalAuthenticatedClient();
  const { data: user } = useCurrentUser({ client });
  const { seat, planLabel } = useSeat();
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const logoutMutation = useLogoutMutation();

  const sidebarItems = useMemo(
    () =>
      billingEnabled
        ? SIDEBAR_ITEMS
        : SIDEBAR_ITEMS.filter((item) => item.id !== "plan-usage"),
    [billingEnabled],
  );

  useHotkeys("escape", close, {
    enabled: isOpen,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  useEffect(() => {
    const handlePopState = () => {
      if (isOpen && !window.history.state?.settingsOpen) {
        useSettingsDialogStore.setState({ isOpen: false });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const ActiveComponent = CATEGORY_COMPONENTS[activeCategory];

  const initials = user
    ? user.first_name && user.last_name
      ? `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
      : (user.email?.substring(0, 2).toUpperCase() ?? "U")
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex bg-(--color-background)"
      data-overlay="settings"
    >
      <div className="flex h-full w-[256px] shrink-0 flex-col border-gray-6 border-r">
        <div className="drag h-[36px] shrink-0 border-b border-b-(--gray-6)" />

        {isAuthenticated && user && initials && (
          <Flex
            align="center"
            gap="3"
            px="3"
            py="3"
            className="border-b border-b-(--gray-5)"
          >
            <Avatar size="2" fallback={initials} radius="full" color="amber" />
            <Flex direction="column" className="min-w-0">
              <Text truncate className="font-medium text-sm">
                {user.email}
              </Text>
              {seat && (
                <Text className="text-(--gray-9) text-[13px]">
                  {planLabel} Plan
                </Text>
              )}
            </Flex>
          </Flex>
        )}

        <button
          type="button"
          className="mt-2 flex cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
          onClick={close}
        >
          <ArrowLeft size={14} />
          <span>Back to app</span>
        </button>

        <ScrollArea className="flex-1">
          <div className="flex flex-col pt-2">
            {sidebarItems.map((item) => {
              const isActive =
                activeCategory === item.id ||
                (item.id === "environments" &&
                  activeCategory === "cloud-environments");
              return (
                <SidebarNavItem
                  key={item.id}
                  item={item}
                  isActive={isActive}
                  onClick={() => setCategory(item.id)}
                />
              );
            })}
          </div>
        </ScrollArea>

        {isAuthenticated && (
          <button
            type="button"
            disabled={logoutMutation.isPending}
            className="flex cursor-pointer items-center gap-2 border-0 border-gray-5 border-t bg-transparent px-3 py-2.5 text-left font-mono text-[12px] text-gray-9 transition-colors hover:bg-gray-3 hover:text-gray-11 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => {
              close();
              logoutMutation.mutate();
            }}
          >
            <SignOut size={14} />
            <span>Sign out</span>
          </button>
        )}
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div className="drag h-[36px] shrink-0 border-b border-b-(--gray-6)" />
        <div className="relative flex flex-1 justify-center overflow-hidden">
          <svg
            aria-hidden="true"
            style={{
              maskImage: "linear-gradient(to top, black 0%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to top, black 0%, transparent 100%)",
            }}
            className="pointer-events-none absolute bottom-0 left-0 h-full w-full opacity-40"
          >
            <defs>
              <pattern
                id="settings-dot-pattern"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
              >
                <circle cx="0" cy="0" r="1" fill="var(--gray-6)" />
                <circle cx="0" cy="8" r="1" fill="var(--gray-6)" />
                <circle cx="8" cy="8" r="1" fill="var(--gray-6)" />
                <circle cx="8" cy="0" r="1" fill="var(--gray-6)" />
                <circle cx="4" cy="4" r="1" fill="var(--gray-6)" />
              </pattern>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="url(#settings-dot-pattern)"
            />
          </svg>
          <ScrollArea className="h-full w-full">
            <Box p="6" mx="auto" className="relative z-[1] max-w-[800px]">
              <Flex direction="column" gap="4">
                {!formMode && (
                  <Text className="font-medium text-lg leading-6.5">
                    {CATEGORY_TITLES[activeCategory]}
                  </Text>
                )}
                <ActiveComponent />
              </Flex>
            </Box>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

interface SidebarNavItemProps {
  item: SidebarItem;
  isActive: boolean;
  onClick: () => void;
}

function SidebarNavItem({ item, isActive, onClick }: SidebarNavItemProps) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3 data-[active]:bg-accent-4 data-[active]:text-gray-12"
      data-active={isActive || undefined}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        <span className="text-gray-10">{item.icon}</span>
        <span>{item.label}</span>
      </span>
      {item.hasChevron && <CaretRight size={12} className="text-gray-9" />}
    </button>
  );
}
