import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  useLogoutMutation,
  useSelectProjectMutation,
} from "@features/auth/hooks/authMutations";
import {
  useAuthStateValue,
  useCurrentUser,
} from "@features/auth/hooks/authQueries";
import { CommandKeyHints } from "@features/command/components/CommandKeyHints";
import { useProjects } from "@features/projects/hooks/useProjects";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import {
  ArrowSquareOut,
  Check,
  DiscordLogo,
  FolderSimple,
  Gear,
  Info,
  Keyboard,
  Plus,
  ShieldCheck,
  SignOut,
} from "@phosphor-icons/react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Kbd,
} from "@posthog/quill";
import { Box } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { EXTERNAL_LINKS } from "@utils/links";
import { isMac } from "@utils/platform";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

type ProjectInfo = { id: number; name: string };
type ProjectGroup = ReturnType<typeof useProjects>["groupedProjects"][number];

export function ProjectSwitcher() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const selectProjectMutation = useSelectProjectMutation();
  const logoutMutation = useLogoutMutation();
  const { groupedProjects, currentProject, currentProjectId } = useProjects();

  const handleProjectSelect = (projectId: number) => {
    if (projectId !== currentProjectId) {
      selectProjectMutation.mutate(projectId);
    }
    setPopoverOpen(false);
    setDialogOpen(false);
  };

  const handleCreateProject = async () => {
    if (cloudRegion) {
      const cloudUrl = getCloudUrlFromRegion(cloudRegion);
      await trpcClient.os.openExternal.mutate({
        url: `${cloudUrl}/organization/create-project`,
      });
    }
    setPopoverOpen(false);
  };

  const handleAllProjects = () => {
    setPopoverOpen(false);
    setDialogOpen(true);
  };

  const openSettings = useSettingsDialogStore((s) => s.open);

  const handleSettings = () => {
    setPopoverOpen(false);
    openSettings();
  };

  const handleKeyboardShortcuts = () => {
    setPopoverOpen(false);
    openSettings("shortcuts");
  };

  const handleOpenExternal = async (url: string) => {
    await trpcClient.os.openExternal.mutate({ url });
    setPopoverOpen(false);
  };

  const handleDiscord = async () => {
    await trpcClient.os.openExternal.mutate({
      url: EXTERNAL_LINKS.discord,
    });
    setPopoverOpen(false);
  };

  const handleLogout = () => {
    setPopoverOpen(false);
    logoutMutation.mutate();
  };

  return (
    <>
      <DropdownMenu open={popoverOpen} onOpenChange={setPopoverOpen}>
        <DropdownMenuTrigger
          render={
            <Item
              size="xs"
              className="border-border hover:bg-fill-hover aria-expanded:bg-fill-active"
            >
              <ItemContent className="select-none">
                <ItemTitle>
                  {currentProject?.name ?? "No project selected"}
                </ItemTitle>
                <ItemDescription className="text-[11px]">
                  {currentUser?.email ?? "No email"}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon className="size-4 rotate-270 group-aria-expanded/item:rotate-90" />
              </ItemActions>
            </Item>
          }
        />

        <DropdownMenuContent
          align="start"
          side="bottom"
          className="w-(--anchor-width) max-w-(--anchor-width) pt-0"
          sideOffset={4}
        >
          <Box>
            <Box className="-mx-1 mb-1 border-border border-b">
              {currentUser ? (
                <Item className="p-2">
                  <ItemContent>
                    <ItemTitle>
                      {currentUser.first_name && (
                        <span>
                          {currentUser.first_name}
                          {currentUser.last_name && ` ${currentUser.last_name}`}
                        </span>
                      )}
                    </ItemTitle>
                    <ItemDescription className="text-[11px]">
                      {currentUser.email}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ) : (
                <>
                  <Box className="mt-1 h-3.5 w-20 animate-pulse rounded bg-gray-6" />
                  <Box className="mt-1 h-3 w-32 animate-pulse rounded bg-gray-5" />
                </>
              )}
            </Box>

            <Box className="flex flex-col gap-px">
              <DropdownMenuItem onClick={handleAllProjects}>
                <FolderSimple size={14} className="text-gray-11" />
                Change project
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleCreateProject}>
                <Plus size={14} className="text-gray-11" />
                Create project
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={handleDiscord}>
                <DiscordLogo size={14} className="text-gray-11" />
                Join our Discord
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Info size={14} className="text-gray-11" />
                  Learn more
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent side="right" sideOffset={4}>
                  <DropdownMenuItem
                    onClick={() => handleOpenExternal(EXTERNAL_LINKS.website)}
                  >
                    <ArrowSquareOut size={14} className="text-gray-11" />
                    PostHog Code Website
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleOpenExternal(EXTERNAL_LINKS.privacy)}
                  >
                    <ShieldCheck size={14} className="text-gray-11" />
                    Privacy Policy
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleKeyboardShortcuts}>
                    <Keyboard size={14} className="text-gray-11" />
                    Keyboard Shortcuts
                    <DropdownMenuShortcut>
                      <Kbd>{isMac ? "⌘/" : "Ctrl+/"}</Kbd>
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem onClick={handleSettings}>
                <Gear size={14} className="text-gray-11" />
                Settings
                <DropdownMenuShortcut>
                  <Kbd>{isMac ? "⌘," : "Ctrl+,"}</Kbd>
                </DropdownMenuShortcut>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={handleLogout}>
                <SignOut size={14} className="text-gray-11" />
                Log out
              </DropdownMenuItem>
            </Box>
          </Box>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectPickerDialogInner
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        groupedProjects={groupedProjects}
        currentProjectId={currentProjectId}
        handleProjectSelect={handleProjectSelect}
      />
    </>
  );
}

interface ProjectPickerDialogInnerProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  groupedProjects: ProjectGroup[];
  currentProjectId: number | null;
  handleProjectSelect: (projectId: number) => void;
}

type ProjectSection = { label?: string; items: ProjectInfo[] };

function ProjectPickerDialogInner({
  dialogOpen,
  setDialogOpen,
  groupedProjects,
  currentProjectId,
  handleProjectSelect,
}: ProjectPickerDialogInnerProps) {
  const [query, setQuery] = useState("");

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setQuery("");
  };

  // Group by org. When there's a single org, drop the label so we don't
  // render a single redundant header.
  const sections: ProjectSection[] = groupedProjects.map((group) => ({
    label: groupedProjects.length > 1 ? group.orgName : undefined,
    items: group.projects,
  }));

  const handleSelect = (id: string | null) => {
    if (id === null) return;
    const projectId = Number(id);
    if (Number.isNaN(projectId)) return;
    handleProjectSelect(projectId);
    // handleProjectSelect closes the dialog via parent state, which skips
    // the Dialog's onOpenChange — so reset the query inline.
    setQuery("");
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[600px] max-w-[90vw] gap-0 p-0"
        showCloseButton={false}
      >
        <Autocomplete<ProjectInfo>
          inline
          defaultOpen
          items={sections}
          value={query}
          autoHighlight="always"
          onValueChange={(val, eventDetails) => {
            if (eventDetails.reason !== "input-change") return;
            if (typeof val === "string") setQuery(val);
          }}
          filter={(project, q) => {
            if (!q) return true;
            return project.name.toLowerCase().includes(q.toLowerCase());
          }}
        >
          <AutocompleteInput
            placeholder="Search projects…"
            autoFocus
            showClear
          />
          <AutocompleteStatus
            emptyContent={
              query ? (
                <span>
                  No projects match <strong>"{query}"</strong>
                </span>
              ) : (
                <span>No projects available</span>
              )
            }
          />
          <AutocompleteList
            className={`max-h-[60vh] ${sections[0]?.label ? "" : "pt-1"}`}
          >
            {(section: ProjectSection, index: number) => (
              <AutocompleteGroup
                key={section.label ?? `group-${index}`}
                items={section.items}
              >
                {section.label && (
                  <AutocompleteLabel>{section.label}</AutocompleteLabel>
                )}
                <AutocompleteCollection>
                  {(project: ProjectInfo) => (
                    <AutocompleteItem
                      key={project.id}
                      value={String(project.id)}
                      onClick={() => handleSelect(String(project.id))}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-[13px]">{project.name}</span>
                      {project.id === currentProjectId && (
                        <Check size={14} className="text-accent-11" />
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
