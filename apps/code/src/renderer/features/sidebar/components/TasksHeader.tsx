import { useMeQuery } from "@hooks/useMeQuery";
import {
  FunnelSimple as FunnelSimpleIcon,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { useCommandMenuStore } from "@stores/commandMenuStore";
import { useSidebarStore } from "../stores/sidebarStore";

function TaskSearchButton() {
  const openCommandMenu = useCommandMenuStore((state) => state.open);
  return (
    <Button
      type="button"
      aria-label="Search tasks"
      size="icon-sm"
      onClick={() => openCommandMenu()}
    >
      <MagnifyingGlass size={14} />
    </Button>
  );
}

function TaskFilterMenu() {
  const organizeMode = useSidebarStore((state) => state.organizeMode);
  const sortMode = useSidebarStore((state) => state.sortMode);
  const showAllUsers = useSidebarStore((state) => state.showAllUsers);
  const showInternal = useSidebarStore((state) => state.showInternal);
  const setOrganizeMode = useSidebarStore((state) => state.setOrganizeMode);
  const setSortMode = useSidebarStore((state) => state.setSortMode);
  const setShowAllUsers = useSidebarStore((state) => state.setShowAllUsers);
  const setShowInternal = useSidebarStore((state) => state.setShowInternal);
  const { data: currentUser } = useMeQuery();
  const isStaff = currentUser?.is_staff === true;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" aria-label="Filter tasks" size="icon-sm">
            <FunnelSimpleIcon size={14} />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="min-w-fit"
      >
        <MenuLabel>Organize</MenuLabel>
        <DropdownMenuRadioGroup
          value={organizeMode}
          onValueChange={(value) =>
            setOrganizeMode(value as typeof organizeMode)
          }
        >
          <DropdownMenuRadioItem value="by-project">
            By project
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="chronological">
            Chronological list
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <MenuLabel>Sort by</MenuLabel>
        <DropdownMenuRadioGroup
          value={sortMode}
          onValueChange={(value) => setSortMode(value as typeof sortMode)}
        >
          <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="updated">Updated</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {import.meta.env.DEV && (
          <>
            <DropdownMenuSeparator />

            <MenuLabel>Show</MenuLabel>
            <DropdownMenuRadioGroup
              value={showAllUsers ? "all" : "mine"}
              onValueChange={(value) => setShowAllUsers(value === "all")}
            >
              <DropdownMenuRadioItem value="mine">
                My tasks
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="all">
                All tasks
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}

        {isStaff && (
          <>
            <DropdownMenuSeparator />

            <MenuLabel>Task visibility</MenuLabel>
            <DropdownMenuRadioGroup
              value={showInternal ? "internal" : "external"}
              onValueChange={(value) => setShowInternal(value === "internal")}
            >
              <DropdownMenuRadioItem value="external">
                External
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="internal">
                Internal
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TasksHeader() {
  return (
    <div className="shrink-0 px-2">
      <MenuLabel className="flex items-center justify-between pt-0 pr-0 pb-0.5">
        Tasks
        <span className="flex items-center">
          <TaskSearchButton />
          <TaskFilterMenu />
        </span>
      </MenuLabel>
    </div>
  );
}
