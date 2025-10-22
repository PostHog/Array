import { Folder as FolderIcon } from "@phosphor-icons/react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Flex,
  IconButton,
  Popover,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useFolderPickerStore } from "../stores/folderPickerStore";
import { Command } from "./command";

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  size?: "1" | "2" | "3";
}

const HOTKEYS = {
  ARROW_UP: "arrowup",
  ARROW_DOWN: "arrowdown",
  ENTER: "enter",
  ESCAPE: "escape",
} as const;

const MAX_RECENT_ITEMS = 5;
const SEARCH_DEBOUNCE_MS = 100;
const MAX_LIST_HEIGHT = "300px";

const displayPath = (path: string): string => {
  const homePattern = /^\/Users\/[^/]+|^\/home\/[^/]+/;
  const match = path.match(homePattern);
  return match ? path.replace(match[0], "~") : path;
};

export function FolderPicker({
  value,
  onChange,
  placeholder = "Select folder...",
  size = "2",
}: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [directoryPreview, setDirectoryPreview] = useState<string[]>([]);
  const [recentPreview, setRecentPreview] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { recentDirectories, addRecentDirectory } = useFolderPickerStore();

  const displayValue = value ? displayPath(value) : placeholder;
  const totalItems = recentPreview.length + directoryPreview.length;

  useHotkeys(
    Object.values(HOTKEYS).join(","),
    (ev, handler) => {
      const key = handler.keys?.join("");

      if (key === HOTKEYS.ARROW_UP || key === HOTKEYS.ARROW_DOWN) {
        ev.preventDefault();
        if (totalItems > 0) {
          const direction = key === HOTKEYS.ARROW_UP ? -1 : 1;
          setSelectedIndex(
            (selectedIndex + direction + totalItems) % totalItems,
          );
        }
        return;
      }

      if (key === HOTKEYS.ENTER) {
        ev.preventDefault();
        if (totalItems > 0) {
          const selectedPath =
            selectedIndex < recentPreview.length
              ? recentPreview[selectedIndex]
              : directoryPreview[selectedIndex - recentPreview.length];

          if (selectedPath) {
            handleSelect(selectedPath);
          }
        }
        return;
      }

      if (key === HOTKEYS.ESCAPE) {
        ev.stopPropagation();
        setOpen(false);
      }
    },
    { enabled: open, enableOnFormTags: true },
  );

  useEffect(() => {
    if (!open) {
      setSearchValue("");
      setDirectoryPreview([]);
      setRecentPreview([]);
      setIsSearching(false);
      return;
    }

    if (!searchValue.trim()) {
      setRecentPreview(recentDirectories.slice(0, MAX_RECENT_ITEMS));
      setDirectoryPreview([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchDirectories(searchValue);
        setDirectoryPreview(results);

        const searchLower = searchValue.toLowerCase();
        const filtered = recentDirectories
          .filter((dir) => dir.toLowerCase().includes(searchLower))
          .slice(0, MAX_RECENT_ITEMS);
        setRecentPreview(filtered);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchValue, recentDirectories, open]);

  const handleSelect = (path: string) => {
    onChange(path);
    addRecentDirectory(path);
    setSearchValue("");
    setOpen(false);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    setSelectedIndex(0);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchValue("");
      setSelectedIndex(0);
    }
  };

  const handleOpenNativeFileFinder = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (selectedPath) {
      handleSelect(selectedPath);
    }
  };

  const renderItem = (path: string, itemIndex: number) => (
    <Command.Item
      key={path}
      className={selectedIndex === itemIndex ? "!bg-accent-3" : ""}
      onSelect={() => handleSelect(path)}
    >
      <Text
        size="2"
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayPath(path)}
      </Text>
    </Command.Item>
  );

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger>
        <Button
          variant="surface"
          size={size}
          color="gray"
          style={{ width: "100%" }}
        >
          <Flex justify="between" align="center" gap="2" width="100%">
            <Flex align="center" gap="2" style={{ minWidth: 0, flex: 1 }}>
              <FolderIcon
                size={16}
                weight="regular"
                style={{ flexShrink: 0 }}
              />
              <Text
                size={size}
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayValue}
              </Text>
            </Flex>
            <ChevronDownIcon style={{ flexShrink: 0 }} />
          </Flex>
        </Button>
      </Popover.Trigger>

      <Popover.Content
        side="bottom"
        align="start"
        avoidCollisions={false}
        style={{ padding: 0, width: "var(--radix-popover-trigger-width)" }}
        onOpenAutoFocus={() => {
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }}
      >
        <Command.Root shouldFilter={false}>
          <Box p="2" style={{ borderBottom: "1px solid var(--gray-a5)" }}>
            <TextField.Root
              ref={searchInputRef}
              placeholder="Search folders..."
              value={searchValue}
              onChange={handleSearchChange}
              size={size}
            >
              <TextField.Slot side="right" style={{ paddingRight: 0 }}>
                <IconButton
                  size="1"
                  onClick={handleOpenNativeFileFinder}
                  type="button"
                  style={{ cursor: "pointer" }}
                >
                  <FolderIcon size={12} weight="fill" />
                </IconButton>
              </TextField.Slot>
            </TextField.Root>
          </Box>

          <Command.List
            style={{ maxHeight: MAX_LIST_HEIGHT, overflowY: "auto" }}
          >
            {totalItems === 0 && (
              <Command.Empty>
                <Box p="4">
                  <Text size="2" color="gray">
                    {isSearching ? "Searching..." : "No folders found"}
                  </Text>
                </Box>
              </Command.Empty>
            )}

            {recentPreview.length > 0 && (
              <Command.Group heading="Recent Directories">
                {recentPreview.map((path, idx) => renderItem(path, idx))}
              </Command.Group>
            )}

            {directoryPreview.length > 0 && (
              <Command.Group heading="Paths">
                {directoryPreview.map((path, idx) =>
                  renderItem(path, recentPreview.length + idx),
                )}
              </Command.Group>
            )}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
  );
}
