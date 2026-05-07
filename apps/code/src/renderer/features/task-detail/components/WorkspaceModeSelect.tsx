import { useSandboxEnvironments } from "@features/settings/hooks/useSandboxEnvironments";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import type { WorkspaceMode } from "@main/services/workspace/schemas";
import {
  ArrowsSplit,
  CaretDown,
  Cloud,
  Laptop,
  Plus,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemMenuItem,
  ItemTitle,
  MenuLabel,
} from "@posthog/quill";
import { useCallback, useMemo, useState } from "react";

export type { WorkspaceMode };

interface WorkspaceModeSelectProps {
  value: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  size?: "1" | "2";
  disabled?: boolean;
  overrideModes?: WorkspaceMode[];
  selectedCloudEnvironmentId?: string | null;
  onCloudEnvironmentChange?: (envId: string | null) => void;
  cloudAvailable?: boolean;
}

const LOCAL_MODES: {
  mode: WorkspaceMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    mode: "worktree",
    label: "Worktree",
    description: "Create a copy of your local project to work in parallel",
    icon: <ArrowsSplit size={14} weight="regular" className="rotate-270" />,
  },
  {
    mode: "local",
    label: "Local",
    description: "Edits your repo directly on current branch",
    icon: <Laptop size={14} weight="regular" />,
  },
];

const CLOUD_ICON = <Cloud size={14} weight="regular" />;

export function WorkspaceModeSelect({
  value,
  onChange,
  disabled,
  overrideModes,
  selectedCloudEnvironmentId,
  onCloudEnvironmentChange,
  cloudAvailable = true,
}: WorkspaceModeSelectProps) {
  const cloudModeEnabled =
    useFeatureFlag("twig-cloud-mode-toggle") || import.meta.env.DEV;

  const { environments } = useSandboxEnvironments();
  const openSettings = useSettingsDialogStore((s) => s.open);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleAddEnvironment = useCallback(() => {
    setMenuOpen(false);
    openSettings("cloud-environments", "create");
  }, [openSettings]);

  const showCloud =
    cloudAvailable &&
    (overrideModes ? overrideModes.includes("cloud") : cloudModeEnabled);

  const localModes = useMemo(
    () =>
      LOCAL_MODES.filter(
        (m) => !overrideModes || overrideModes.includes(m.mode),
      ),
    [overrideModes],
  );

  const selectedEnvName = useMemo(() => {
    if (value !== "cloud" || !selectedCloudEnvironmentId) return null;
    return environments.find((e) => e.id === selectedCloudEnvironmentId)?.name;
  }, [value, selectedCloudEnvironmentId, environments]);

  const triggerLabel = useMemo(() => {
    if (value === "cloud") {
      return selectedEnvName ? `Cloud · ${selectedEnvName}` : "Cloud";
    }
    return LOCAL_MODES.find((m) => m.mode === value)?.label ?? "Worktree";
  }, [value, selectedEnvName]);

  const triggerIcon = useMemo(() => {
    if (value === "cloud") return CLOUD_ICON;
    return (
      LOCAL_MODES.find((m) => m.mode === value)?.icon ?? LOCAL_MODES[0].icon
    );
  }, [value]);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="Workspace mode"
          >
            <span className="text-muted-foreground">{triggerIcon}</span>
            {triggerLabel}
            <CaretDown
              size={10}
              weight="bold"
              className="text-muted-foreground"
            />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-auto min-w-[280px]"
      >
        <DropdownMenuGroup>
          {localModes.map((item) => (
            <DropdownMenuItem
              key={item.mode}
              onClick={() => {
                onChange(item.mode);
                onCloudEnvironmentChange?.(null);
              }}
              render={
                <ItemMenuItem size="xs" className="w-full">
                  <ItemMedia variant="icon" className="mt-2 ml-2">
                    <span>{item.icon}</span>
                  </ItemMedia>
                  <ItemContent variant="menuItem">
                    <ItemTitle>{item.label}</ItemTitle>
                    <ItemDescription className="whitespace-nowrap leading-none">
                      {item.description}
                    </ItemDescription>
                  </ItemContent>
                </ItemMenuItem>
              }
            />
          ))}
        </DropdownMenuGroup>

        {showCloud && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between px-2 py-1">
              <MenuLabel className="p-0">Cloud environments</MenuLabel>
              {environments.length > 0 && (
                <button
                  type="button"
                  onClick={handleAddEnvironment}
                  aria-label="Add cloud environment"
                  className="flex cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0.5 text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground"
                >
                  <Plus size={12} />
                </button>
              )}
            </div>

            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  onChange("cloud");
                  onCloudEnvironmentChange?.(null);
                }}
                render={
                  <ItemMenuItem size="xs" className="w-full">
                    <ItemMedia variant="icon" className="mt-2 ml-2">
                      <span>{CLOUD_ICON}</span>
                    </ItemMedia>
                    <ItemContent variant="menuItem">
                      <ItemTitle>Default</ItemTitle>
                      <ItemDescription className="whitespace-nowrap leading-none">
                        Full network access
                      </ItemDescription>
                    </ItemContent>
                  </ItemMenuItem>
                }
              />

              {environments.map((env) => (
                <DropdownMenuItem
                  key={`cloud-env-${env.id}`}
                  onClick={() => {
                    onChange("cloud");
                    onCloudEnvironmentChange?.(env.id);
                  }}
                  render={
                    <ItemMenuItem size="xs" className="w-full">
                      <ItemMedia variant="icon" className="mt-2 ml-2">
                        <span>{CLOUD_ICON}</span>
                      </ItemMedia>
                      <ItemContent variant="menuItem">
                        <ItemTitle>{env.name}</ItemTitle>
                        <ItemDescription className="whitespace-nowrap leading-none">
                          {env.network_access_level === "full"
                            ? "Full network access"
                            : env.network_access_level === "trusted"
                              ? "Trusted sources only"
                              : `${env.allowed_domains.length} allowed domain${env.allowed_domains.length !== 1 ? "s" : ""}`}
                        </ItemDescription>
                      </ItemContent>
                    </ItemMenuItem>
                  }
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
