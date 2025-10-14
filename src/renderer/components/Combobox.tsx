import { CheckIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { Box, Button, Flex, Popover, Text, TextField } from "@radix-ui/themes";
import { type ReactNode, useMemo, useState } from "react";
import { Command } from "./command";

interface ComboboxItem {
  value: string;
  label: string;
}

interface ComboboxProps {
  items: ComboboxItem[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  size?: "1" | "2" | "3";
  variant?: "classic" | "surface" | "soft" | "ghost" | "outline";
  renderItem?: (item: ComboboxItem) => ReactNode;
  icon?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

export function Combobox({
  items,
  value,
  onValueChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No items found",
  size = "2",
  variant = "surface",
  renderItem,
  icon,
  side = "bottom",
  align = "start",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedItem = useMemo(() => {
    if (!value) return null;
    return items.find((item) => item.value === value);
  }, [value, items]);

  const displayValue = selectedItem ? selectedItem.label : placeholder;

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue);
    setOpen(false);
    setSearch("");
  };

  const filteredItems = useMemo(() => {
    if (!search) return items;
    return items.filter((item) =>
      item.label.toLowerCase().includes(search.toLowerCase()),
    );
  }, [items, search]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) setSearch("");
      }}
    >
      <Popover.Trigger>
        <Button variant={variant} size={size} color="gray">
          <Flex justify="between" align="center" gap="2" width="100%">
            <Flex align="center" gap="2">
              {icon}
              <Text size={size}>{displayValue}</Text>
            </Flex>
            <ChevronDownIcon />
          </Flex>
        </Button>
      </Popover.Trigger>
      <Popover.Content side={side} align={align} style={{ padding: 0 }}>
        <Command.Root shouldFilter={false}>
          <Box p="2" style={{ borderBottom: "1px solid var(--gray-a5)" }}>
            <TextField.Root
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              size={size}
            />
          </Box>
          <Command.List style={{ maxHeight: "300px", overflowY: "auto" }}>
            <Command.Empty>
              <Box p="4">
                <Text size="2" color="gray">
                  {emptyMessage}
                </Text>
              </Box>
            </Command.Empty>
            <Command.Group>
              {filteredItems.map((item) => {
                const isSelected = value === item.value;
                return (
                  <Command.Item
                    key={item.value}
                    value={item.value}
                    onSelect={() => handleSelect(item.value)}
                  >
                    <Flex justify="between" align="center" gap="2" width="100%">
                      {renderItem ? (
                        renderItem(item)
                      ) : (
                        <Text size={size}>{item.label}</Text>
                      )}
                      <CheckIcon
                        style={{
                          opacity: isSelected ? 1 : 0,
                        }}
                      />
                    </Flex>
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
  );
}
