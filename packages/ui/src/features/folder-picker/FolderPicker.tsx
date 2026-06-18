import {
  CaretDown,
  CircleNotch,
  Folder as FolderIcon,
  FolderOpen,
  GitBranch,
} from "@phosphor-icons/react";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import { useService } from "@posthog/di/react";
import { useHostTRPCClient } from "@posthog/host-router/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { useFolders } from "@posthog/ui/features/folders/useFolders";
import { FIELD_TRIGGER_CLASS } from "@posthog/ui/styles/fieldTrigger";
import { Flex, Text } from "@radix-ui/themes";
import { type RefObject, useState } from "react";

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  variant?: "compact" | "field";
  anchor?: RefObject<HTMLElement | null>;
}

export function FolderPicker({
  value,
  onChange,
  placeholder = "Select folder...",
  variant = "compact",
  anchor,
}: FolderPickerProps) {
  const trpcClient = useHostTRPCClient();
  const log = useService<RootLogger>(ROOT_LOGGER);
  const {
    getRecentFolders,
    getFolderDisplayName,
    addFolder,
    updateLastAccessed,
    getFolderByPath,
  } = useFolders();

  const recentFolders = getRecentFolders();
  const displayValue = getFolderDisplayName(value);
  const isField = variant === "field";

  const [isOpening, setIsOpening] = useState(false);

  const handleSelect = (path: string) => {
    onChange(path);
    const folder = getFolderByPath(path);
    if (folder) updateLastAccessed(folder.id);
  };

  const handleOpenFilePicker = async () => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      const selectedPath = await trpcClient.os.selectDirectory.query();
      if (!selectedPath) return;
      await addFolder(selectedPath);
      onChange(selectedPath);
    } catch (error) {
      log.error("Failed to open folder picker", { error });
    } finally {
      setIsOpening(false);
    }
  };

  const fieldContent = (
    <>
      <Flex align="center" gap="2" className="min-w-0 flex-1">
        <FolderIcon size={16} className="shrink-0 text-(--gray-12)" />
        <Text
          className="min-w-0 max-w-full truncate text-left font-medium text-(--gray-12)"
          title={displayValue || undefined}
        >
          {isOpening ? "Opening..." : displayValue || placeholder}
        </Text>
      </Flex>
      {isOpening ? (
        <CircleNotch
          size={14}
          className="shrink-0 animate-spin text-(--gray-9)"
        />
      ) : (
        <CaretDown size={14} className="shrink-0 text-(--gray-9)" />
      )}
    </>
  );

  const compactContent = (
    <>
      <FolderIcon size={14} weight="regular" className="shrink-0" />
      <span className="max-w-[120px] truncate">
        {isOpening ? "Opening..." : displayValue || placeholder}
      </span>
      {isOpening ? (
        <CircleNotch size={10} className="animate-spin text-muted-foreground" />
      ) : (
        <CaretDown size={10} weight="bold" className="text-muted-foreground" />
      )}
    </>
  );

  if (recentFolders.length === 0) {
    return isField ? (
      <button
        type="button"
        onClick={handleOpenFilePicker}
        className={FIELD_TRIGGER_CLASS}
        disabled={isOpening}
        aria-busy={isOpening}
      >
        {fieldContent}
      </button>
    ) : (
      <Button
        variant="outline"
        size="sm"
        aria-label="Folder"
        onClick={handleOpenFilePicker}
        disabled={isOpening}
        aria-busy={isOpening}
      >
        {compactContent}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          isField ? (
            <button type="button" className={FIELD_TRIGGER_CLASS}>
              {fieldContent}
            </button>
          ) : (
            <Button variant="outline" size="sm" aria-label="Folder">
              {compactContent}
            </Button>
          )
        }
      />
      <DropdownMenuContent
        anchor={anchor}
        align="start"
        side="bottom"
        sideOffset={isField ? 4 : 6}
        className={
          isField
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
