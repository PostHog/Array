import { Command } from "@features/command/components/Command";
import { GitBranch as GitBranchIcon } from "@phosphor-icons/react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { Box, Button, Flex, Popover, Text, TextField } from "@radix-ui/themes";
import { useRepositoryIntegration } from "@renderer/hooks/useIntegrations";
import type { RepositoryConfig } from "@shared/types";
import { cloneStore } from "@stores/cloneStore";
import { useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

interface RepositoryPickerProps {
  value: RepositoryConfig | null;
  onChange: (repo: RepositoryConfig) => void;
  placeholder?: string;
  size?: "1" | "2" | "3";
}

const HOTKEYS = {
  ARROW_UP: "arrowup",
  ARROW_DOWN: "arrowdown",
  ENTER: "enter",
  ESCAPE: "escape",
} as const;

const MAX_LIST_HEIGHT = "300px";

export function RepositoryPicker({
  value,
  onChange,
  placeholder = "Select repository...",
}: RepositoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { repositories, githubIntegration } = useRepositoryIntegration();
  const { isCloning } = cloneStore();

  const displayValue = value ? `${value.repository}` : placeholder;

  // Compute filtered repositories
  const filteredRepos = useMemo(() => {
    if (!open) return [];
    if (!searchValue.trim()) return repositories;

    const searchLower = searchValue.toLowerCase();
    return repositories.filter(
      (repo) =>
        repo.repository.toLowerCase().includes(searchLower) ||
        repo.organization.toLowerCase().includes(searchLower),
    );
  }, [open, searchValue, repositories]);

  const totalItems = filteredRepos.length;

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
        if (totalItems > 0 && filteredRepos[selectedIndex]) {
          handleSelect(filteredRepos[selectedIndex]);
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

  const handleSelect = (repo: RepositoryConfig) => {
    onChange(repo);
    setSearchValue("");
    setOpen(false);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    setSelectedIndex(0); // Reset selection when search changes
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchValue("");
      setSelectedIndex(0);
    }
  };

  const renderItem = (repo: RepositoryConfig) => {
    const repoKey = `${repo.organization}/${repo.repository}`;
    const cloning = isCloning(repoKey);

    return (
      <Command.Item
        key={repoKey}
        onSelect={() => handleSelect(repo)}
        disabled={cloning}
      >
        <Flex direction="row" gap="4" align="center">
          <Text size="1" color={cloning ? "gray" : undefined}>
            {repo.repository}
          </Text>
          <Text size="1" color="gray" className="text-gray-9">
            {repo.organization}
          </Text>
          {cloning && (
            <Text size="1" color="amber">
              Cloning...
            </Text>
          )}
        </Flex>
      </Command.Item>
    );
  };

  const hasIntegration = githubIntegration !== null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger>
        <Button
          variant="outline"
          size="1"
          color="gray"
          style={{ width: "100%" }}
          disabled={!hasIntegration}
        >
          <Flex justify="between" align="center" gap="2" width="100%">
            <Flex align="center" gap="2" style={{ minWidth: 0, flex: 1 }}>
              <GitBranchIcon
                size={16}
                weight="regular"
                style={{ flexShrink: 0 }}
              />
              <Text
                size="1"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {!hasIntegration ? "No GitHub integration" : displayValue}
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
              placeholder="Search repositories..."
              value={searchValue}
              onChange={handleSearchChange}
              size="1"
            />
          </Box>

          <Command.List
            style={{ maxHeight: MAX_LIST_HEIGHT, overflowY: "auto" }}
          >
            {totalItems === 0 && (
              <Command.Empty>
                <Box p="4">
                  <Text size="1" color="gray">
                    {repositories.length === 0
                      ? "No repositories available"
                      : "No matching repositories"}
                  </Text>
                </Box>
              </Command.Empty>
            )}

            {filteredRepos.length > 0 && (
              <Command.Group>
                {filteredRepos.map((repo) => renderItem(repo))}
              </Command.Group>
            )}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
  );
}
