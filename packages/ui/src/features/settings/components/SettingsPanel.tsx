import {
  ArrowLeft,
  ArrowsClockwise,
  Bell,
  CaretRight,
  Code,
  CreditCard,
  Cube,
  DiscordLogo,
  Folder,
  GearSix,
  GithubLogo,
  Keyboard,
  Lightbulb,
  Palette,
  Plugs,
  Robot,
  SignOut,
  SlackLogo,
  Terminal,
  TrafficSignal,
  TreeStructure,
  Wrench,
} from "@phosphor-icons/react";
import { BILLING_FLAG } from "@posthog/shared";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useLogoutMutation } from "@posthog/ui/features/auth/useAuthMutations";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { McpServersView } from "@posthog/ui/features/mcp-servers/components/McpServersView";
import { closeSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { AdvancedSettings } from "@posthog/ui/features/settings/sections/AdvancedSettings";
import { AgentsSettings } from "@posthog/ui/features/settings/sections/AgentsSettings";
import { ClaudeCodeSettings } from "@posthog/ui/features/settings/sections/ClaudeCodeSettings";
import { DiscordSettings } from "@posthog/ui/features/settings/sections/DiscordSettings";
import { EnvironmentsSettings } from "@posthog/ui/features/settings/sections/environments/EnvironmentsSettings";
import { GeneralSettings } from "@posthog/ui/features/settings/sections/GeneralSettings";
import { GitHubSettings } from "@posthog/ui/features/settings/sections/GitHubSettings";
import { NotificationsSettings } from "@posthog/ui/features/settings/sections/NotificationsSettings";
import { PersonalizationSettings } from "@posthog/ui/features/settings/sections/PersonalizationSettings";
import { PlanUsageSettings } from "@posthog/ui/features/settings/sections/PlanUsageSettings";
import { ShortcutsSettings } from "@posthog/ui/features/settings/sections/ShortcutsSettings";
import { SignalSourcesSettings } from "@posthog/ui/features/settings/sections/SignalSourcesSettings";
import { SlackSettings } from "@posthog/ui/features/settings/sections/SlackSettings";
import { TerminalSettings } from "@posthog/ui/features/settings/sections/TerminalSettings";
import { UpdatesSettings } from "@posthog/ui/features/settings/sections/UpdatesSettings";
import { WorkspacesSettings } from "@posthog/ui/features/settings/sections/WorkspacesSettings";
import { WorktreesSettings } from "@posthog/ui/features/settings/sections/worktrees/WorktreesSettings";
import { useSettingsPageStore } from "@posthog/ui/features/settings/stores/settingsPageStore";
import type { SettingsCategory } from "@posthog/ui/features/settings/types";
import { SkillsView } from "@posthog/ui/features/skills/SkillsView";
import { useSpendAnalysisEnabled } from "@posthog/ui/features/usage/useSpendAnalysisEnabled";
import * as nav from "@posthog/ui/router/navigationBridge";
import { useHostCapabilities } from "@posthog/ui/shell/useHostCapabilities";
import { Avatar, Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { type ReactNode, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";

interface SidebarItem {
  id: SettingsCategory;
  label: string;
  icon: ReactNode;
  hasChevron?: boolean;
}

interface SidebarGroup {
  label: string | null;
  items: SidebarItem[];
}

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    label: null,
    items: [
      { id: "general", label: "General", icon: <GearSix size={16} /> },
      { id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
      {
        id: "plan-usage",
        label: "Plan & usage",
        icon: <CreditCard size={16} />,
      },
    ],
  },
  {
    label: "Agents",
    items: [
      { id: "agents", label: "Agents", icon: <Robot size={16} /> },
      { id: "skills", label: "Skills", icon: <Lightbulb size={16} /> },
      { id: "mcp-servers", label: "MCP servers", icon: <Plugs size={16} /> },
      { id: "claude-code", label: "Claude Code", icon: <Code size={16} /> },
      {
        id: "personalization",
        label: "Personalization",
        icon: <Palette size={16} />,
      },
      {
        id: "signals",
        label: "Self-driving",
        icon: <TrafficSignal size={16} />,
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "workspaces", label: "Workspaces", icon: <Folder size={16} /> },
      {
        id: "worktrees",
        label: "Worktrees",
        icon: <TreeStructure size={16} />,
      },
      { id: "environments", label: "Environments", icon: <Cube size={16} /> },
    ],
  },
  {
    label: "Integrations",
    items: [
      { id: "github", label: "GitHub", icon: <GithubLogo size={16} /> },
      { id: "slack", label: "Slack", icon: <SlackLogo size={16} /> },
      { id: "discord", label: "Discord", icon: <DiscordLogo size={16} /> },
    ],
  },
  {
    label: "App",
    items: [
      { id: "terminal", label: "Terminal", icon: <Terminal size={16} /> },
      { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
      { id: "updates", label: "Updates", icon: <ArrowsClockwise size={16} /> },
      { id: "advanced", label: "Advanced", icon: <Wrench size={16} /> },
    ],
  },
];

const SIDEBAR_ITEMS = SIDEBAR_GROUPS.flatMap((group) => group.items);

// Settings that only make sense with a local filesystem/host (local worktrees,
// terminal, the local `claude` CLI, the desktop app itself). Hidden on the
// cloud-only web host.
const LOCAL_ONLY_CATEGORIES: ReadonlySet<SettingsCategory> = new Set([
  "workspaces",
  "worktrees",
  "terminal",
  "claude-code",
  "discord",
  "updates",
]);

const CATEGORY_TITLES: Record<SettingsCategory, string> = {
  general: "General",
  notifications: "Notifications",
  "plan-usage": "Plan & usage",
  workspaces: "Workspaces",
  worktrees: "Worktrees",
  environments: "Environments",
  "cloud-environments": "Environments",
  agents: "Agents",
  skills: "Skills",
  "mcp-servers": "MCP servers",
  personalization: "Personalization",
  terminal: "Terminal",
  "claude-code": "Claude Code",
  shortcuts: "Shortcuts",
  github: "GitHub",
  slack: "Slack integration",
  discord: "Discord",
  signals: "Self-driving",
  updates: "Updates",
  advanced: "Advanced",
};

const CATEGORY_COMPONENTS: Record<SettingsCategory, React.ComponentType> = {
  general: GeneralSettings,
  notifications: NotificationsSettings,
  "plan-usage": PlanUsageSettings,
  workspaces: WorkspacesSettings,
  worktrees: WorktreesSettings,
  environments: EnvironmentsSettings,
  "cloud-environments": EnvironmentsSettings,
  agents: AgentsSettings,
  skills: SkillsView,
  "mcp-servers": McpServersView,
  personalization: PersonalizationSettings,
  terminal: TerminalSettings,
  "claude-code": ClaudeCodeSettings,
  shortcuts: ShortcutsSettings,
  github: GitHubSettings,
  slack: SlackSettings,
  discord: DiscordSettings,
  // Slack notification config lives in the dedicated Slack section; the Signals
  // section links out to it rather than duplicating the controls.
  signals: () => <SignalSourcesSettings showSlackNotifications={false} />,
  updates: UpdatesSettings,
  advanced: AdvancedSettings,
};

const FULL_HEIGHT_CATEGORIES: ReadonlySet<SettingsCategory> = new Set([
  "skills",
  "mcp-servers",
]);

export interface SettingsPanelProps {
  /**
   * Override the active category. Defaults to the `$category` URL param
   * (which is what every in-app entry point uses). Provided for the
   * pre-router `AiApprovalScreen` shell where RouterProvider isn't mounted.
   */
  activeCategory?: SettingsCategory;
  /** Override the close handler. Defaults to router history back. */
  onClose?: () => void;
  /** Override the category-change handler. Defaults to router navigation. */
  onCategoryChange?: (category: SettingsCategory) => void;
}

export function SettingsPanel({
  activeCategory: activeCategoryProp,
  onClose,
  onCategoryChange,
}: SettingsPanelProps = {}) {
  const formMode = useSettingsPageStore((s) => s.formMode);
  const activeCategory = activeCategoryProp ?? "general";
  const close = onClose ?? closeSettings;
  const setCategory =
    onCategoryChange ??
    ((cat: SettingsCategory) => nav.navigateToSettings(cat, { replace: true }));
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const client = useOptionalAuthenticatedClient();
  const { data: user } = useCurrentUser({ client });
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const { localWorkspaces } = useHostCapabilities();
  const logoutMutation = useLogoutMutation();

  const spendAnalysisEnabled = useSpendAnalysisEnabled();
  const sidebarGroups = useMemo(
    () =>
      SIDEBAR_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (
            item.id === "plan-usage" &&
            !billingEnabled &&
            !spendAnalysisEnabled
          )
            return false;
          if (!localWorkspaces && LOCAL_ONLY_CATEGORIES.has(item.id))
            return false;
          return true;
        }),
      })).filter((group) => group.items.length > 0),
    [billingEnabled, spendAnalysisEnabled, localWorkspaces],
  );

  // Guard direct navigation (URL, deep link, programmatic openSettings) to a
  // category hidden on this host. Fall back to General so a hidden section is
  // never rendered.
  const resolvedCategory: SettingsCategory =
    !localWorkspaces && LOCAL_ONLY_CATEGORIES.has(activeCategory)
      ? "general"
      : activeCategory;

  useHotkeys("escape", close, {
    enabled: true,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  const ActiveComponent = CATEGORY_COMPONENTS[resolvedCategory];

  const activeCategoryIcon = SIDEBAR_ITEMS.find(
    (item) =>
      item.id === resolvedCategory ||
      (item.id === "environments" && resolvedCategory === "cloud-environments"),
  )?.icon;

  const initials = getUserInitials(user);

  return (
    <div
      className="flex h-full w-full bg-(--color-background)"
      data-page="settings"
    >
      <div className="flex h-full w-[256px] shrink-0 flex-col border-gray-6 border-r">
        <div className="drag h-[36px] shrink-0 border-b border-b-(--gray-6)" />

        {isAuthenticated && user && (
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
          <div className="flex flex-col py-2">
            {sidebarGroups.map((group) => (
              <div key={group.label ?? "general"}>
                {group.label && (
                  <Text
                    color="gray"
                    className="px-3 pt-4 pb-1 font-medium text-[10px] uppercase tracking-[0.06em]"
                  >
                    {group.label}
                  </Text>
                )}
                {group.items.map((item) => {
                  const isActive =
                    resolvedCategory === item.id ||
                    (item.id === "environments" &&
                      resolvedCategory === "cloud-environments");
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
            ))}
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
          {FULL_HEIGHT_CATEGORIES.has(resolvedCategory) ? (
            <Flex
              direction="column"
              className="relative z-[1] h-full min-h-0 w-full"
            >
              {!formMode && (
                <Flex
                  align="center"
                  gap="2"
                  className="shrink-0 border-gray-5 border-b px-6 py-4"
                >
                  {activeCategoryIcon && (
                    <span className="text-gray-10">{activeCategoryIcon}</span>
                  )}
                  <Text className="font-medium text-lg leading-6.5">
                    {CATEGORY_TITLES[resolvedCategory]}
                  </Text>
                </Flex>
              )}
              <div className="min-h-0 flex-1">
                <ActiveComponent />
              </div>
            </Flex>
          ) : (
            <ScrollArea className="h-full w-full">
              <Box p="6" mx="auto" className="relative z-[1] max-w-[800px]">
                <Flex direction="column" gap="4">
                  {!formMode && (
                    <Flex align="center" gap="2">
                      {activeCategoryIcon && (
                        <span className="text-gray-10">
                          {activeCategoryIcon}
                        </span>
                      )}
                      <Text className="font-medium text-lg leading-6.5">
                        {CATEGORY_TITLES[resolvedCategory]}
                      </Text>
                    </Flex>
                  )}
                  <ActiveComponent />
                </Flex>
              </Box>
            </ScrollArea>
          )}
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
