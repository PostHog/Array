import { CheckIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { Button, Flex, Popover, Text } from "@radix-ui/themes";
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
  variant?: "classic" | "surface" | "soft" | "ghost";
  renderItem?: (item: ComboboxItem) => ReactNode;
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
  side = "bottom",
  align = "start",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);

  const selectedItem = useMemo(() => {
    if (!value) return null;
    return items.find((item) => item.value === value);
  }, [value, items]);

  const displayValue = selectedItem ? selectedItem.label : placeholder;

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button variant={variant} size={size} color="gray">
          <Flex justify="between" align="center" gap="2" width="100%">
            <Text size={size}>{displayValue}</Text>
            <ChevronDownIcon />
          </Flex>
        </Button>
      </Popover.Trigger>
      <Popover.Content side={side} align={align} style={{ padding: 0 }}>
        <Command.Root>
          <Command.Input placeholder={searchPlaceholder} autoFocus />
          <Command.List>
            <Command.Empty>{emptyMessage}</Command.Empty>
            <Command.Group>
              {items.map((item) => {
                const isSelected = value === item.value;
                return (
                  <Command.Item
                    key={item.value}
                    value={item.value}
                    keywords={[item.label]}
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
