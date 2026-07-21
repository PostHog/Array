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
  SlackLogo,
  Terminal,
  TrafficSignal,
  TreeStructure,
  Wrench,
} from "@phosphor-icons/react";
import { BILLING_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { SettingsPageContent } from "@posthog/ui/features/settings/components/SettingsPageContent";
import { closeSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { useSettingsPageStore } from "@posthog/ui/features/settings/stores/settingsPageStore";
import type { SettingsCategory } from "@posthog/ui/features/settings/types";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { useSpendAnalysisEnabled } from "@posthog/ui/features/usage/useSpendAnalysisEnabled";
import * as nav from "@posthog/ui/router/navigationBridge";
import { useHostCapabilities } from "@posthog/ui/shell/useHostCapabilities";
import { Box, ScrollArea, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { useHotkeys } from "react-hotkeys-hook";

interface SidebarItem {
  id: SettingsCategory;
  label: string;
  icon: ReactNode;
  hasChevron?: boolean;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    label: "Account",
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
    label: "Configure",
    items: [
      { id: "agents", label: "Agents", icon: <Robot size={16} /> },
      { id: "skills", label: "Skills", icon: <Lightbulb size={16} /> },
      { id: "mcp-servers", label: "MCP servers", icon: <Plugs size={16} /> },
      { id: "claude-code", label: "Claude Code", icon: <Code size={16} /> },
      {
        id: "signals",
        label: "Self-driving",
        icon: <TrafficSignal size={16} />,
      },
    ],
  },
  {
    label: "Experience",
    items: [
      {
        id: "personalization",
        label: "Personalization",
        icon: <Palette size={16} />,
      },
      { id: "terminal", label: "Terminal", icon: <Terminal size={16} /> },
      { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
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
    label: "Application",
    items: [
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

interface SettingsVisibility {
  billingEnabled: boolean;
  spendAnalysisEnabled: boolean;
  localWorkspaces: boolean;
}

function getHiddenSettingsCategories({
  billingEnabled,
  spendAnalysisEnabled,
  localWorkspaces,
}: SettingsVisibility): ReadonlySet<SettingsCategory> {
  const hiddenCategories = new Set<SettingsCategory>();

  if (!billingEnabled && !spendAnalysisEnabled) {
    hiddenCategories.add("plan-usage");
  }
  if (!localWorkspaces) {
    for (const category of LOCAL_ONLY_CATEGORIES) {
      hiddenCategories.add(category);
    }
  }

  return hiddenCategories;
}

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
  /** Whether to show the settings navigation sidebar. */
  sidebarOpen?: boolean;
}

export function SettingsPanel({
  activeCategory: activeCategoryProp,
  onClose,
  onCategoryChange,
  sidebarOpen = true,
}: SettingsPanelProps = {}) {
  const formMode = useSettingsPageStore((s) => s.formMode);
  const activeCategory = activeCategoryProp ?? "general";
  const close = onClose ?? closeSettings;
  const setCategory =
    onCategoryChange ??
    ((cat: SettingsCategory) => nav.navigateToSettings(cat, { replace: true }));
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const { localWorkspaces } = useHostCapabilities();

  const spendAnalysisEnabled = useSpendAnalysisEnabled();
  const hiddenCategories = getHiddenSettingsCategories({
    billingEnabled,
    spendAnalysisEnabled,
    localWorkspaces,
  });
  const sidebarGroups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !hiddenCategories.has(item.id)),
  })).filter((group) => group.items.length > 0);

  // Guard direct navigation (URL, deep link, programmatic openSettings) to a
  // category hidden on this host. Fall back to General so a hidden section is
  // never rendered.
  const resolvedCategory: SettingsCategory =
    !localWorkspaces && LOCAL_ONLY_CATEGORIES.has(activeCategory)
      ? "general"
      : activeCategory;
  const activeSidebarCategory: SettingsCategory =
    resolvedCategory === "cloud-environments"
      ? "environments"
      : resolvedCategory;

  useHotkeys("escape", close, {
    enabled: true,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  const activeCategoryIcon = SIDEBAR_ITEMS.find(
    (item) => item.id === activeSidebarCategory,
  )?.icon;

  return (
    <div
      className="flex h-full w-full bg-(--color-background)"
      data-page="settings"
    >
      {sidebarOpen && (
        <div className="flex h-full w-[256px] shrink-0 flex-col border-gray-6 border-r">
          <button
            type="button"
            className="mt-2 flex cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
            onClick={close}
          >
            <ArrowLeft size={14} />
            <span>Back to app</span>
          </button>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-3 py-2">
              {sidebarGroups.map((group) => (
                <div key={group.label}>
                  <Text className="px-3 pb-1 font-medium text-[10px] text-gray-9 uppercase tracking-wider">
                    {group.label}
                  </Text>
                  {group.items.map((item) => {
                    const isActive = activeSidebarCategory === item.id;
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

          <Box className="shrink-0 px-2 pb-2">
            <ProjectSwitcher />
          </Box>
        </div>
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden">
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
          <SettingsPageContent
            category={resolvedCategory}
            formMode={formMode}
            icon={activeCategoryIcon}
          />
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
