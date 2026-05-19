import { useFolders } from "@features/folders/hooks/useFolders";
import {
  CaretDown,
  Folder as FolderIcon,
  FolderOpen,
  GitBranch,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { Flex, Text } from "@radix-ui/themes";
import { FIELD_TRIGGER_CLASS } from "@renderer/styles/fieldTrigger";
import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";
import type { Ref, RefObject } from "react";

const log = logger.scope("folder-picker");

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  variant?: "compact" | "field";
  anchor?: RefObject<HTMLElement | null>;
}

interface TriggerProps {
  ref?: Ref<HTMLButtonElement>;
  displayValue: string | null;
  placeholder: string;
  onClick?: () => void;
}

function CompactTrigger({
  ref,
  displayValue,
  placeholder,
  onClick,
}: TriggerProps) {
  return (
    <Button
      ref={ref}
      variant="outline"
      size="sm"
      aria-label="Folder"
      onClick={onClick}
    >
      <FolderIcon size={14} weight="regular" className="shrink-0" />
      <span className="max-w-[120px] truncate">
        {displayValue || placeholder}
      </span>
      <CaretDown size={10} weight="bold" className="text-muted-foreground" />
    </Button>
  );
}

function FieldTrigger({
  ref,
  displayValue,
  placeholder,
  onClick,
}: TriggerProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={FIELD_TRIGGER_CLASS}
    >
      <Flex align="center" gap="2" className="min-w-0 flex-1">
        <FolderIcon size={16} className="shrink-0 text-(--gray-12)" />
        <Text
          className="min-w-0 max-w-full truncate text-left font-medium text-(--gray-12)"
          title={displayValue || undefined}
        >
          {displayValue || placeholder}
        </Text>
      </Flex>
      <CaretDown size={14} className="shrink-0 text-(--gray-9)" />
    </button>
  );
}

export function FolderPicker({
  value,
  onChange,
  placeholder = "Select folder...",
  variant = "compact",
  anchor,
}: FolderPickerProps) {
  const {
    getRecentFolders,
    getFolderDisplayName,
    addFolder,
    updateLastAccessed,
    getFolderByPath,
  } = useFolders();

  const recentFolders = getRecentFolders();
  const displayValue = getFolderDisplayName(value);

  const handleSelect = (path: string) => {
    onChange(path);
    const folder = getFolderByPath(path);
    if (folder) updateLastAccessed(folder.id);
  };

  const handleOpenFilePicker = async () => {
    try {
      const selectedPath = await trpcClient.os.selectDirectory.query();
      if (!selectedPath) return;
      await addFolder(selectedPath);
      onChange(selectedPath);
    } catch (error) {
      log.error("Failed to open folder picker", { error });
    }
  };

  const Trigger = variant === "field" ? FieldTrigger : CompactTrigger;

  if (recentFolders.length === 0) {
    return (
      <Trigger
        displayValue={displayValue}
        placeholder={placeholder}
        onClick={handleOpenFilePicker}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Trigger displayValue={displayValue} placeholder={placeholder} />
        }
      />
      <DropdownMenuContent
        anchor={anchor}
        align="start"
        side="bottom"
        sideOffset={variant === "field" ? 4 : 6}
        className={
          variant === "field"
            ? "w-(--anchor-width) min-w-(--anchor-width) max-w-(--anchor-width)"
            : "min-w-[200px]"
        }
      >
        <MenuLabel>Recent</MenuLabel>
        {recentFolders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onClick={() => handleSelect(folder.path)}
          >
            <GitBranch size={12} className="shrink-0" />
            <span
              className="min-w-0 flex-1 truncate text-left"
              title={folder.path}
            >
              {folder.name}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleOpenFilePicker}>
          <FolderOpen size={12} className="shrink-0" />
          <span className="whitespace-nowrap">Open folder...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
