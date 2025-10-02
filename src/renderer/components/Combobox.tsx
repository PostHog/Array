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
  allowNone?: boolean;
  noneLabel?: string;
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
  allowNone = true,
  noneLabel = "None",
  renderItem,
  side = "bottom",
  align = "start",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);

  const selectedItem = useMemo(() => {
    if (!value || value === "__none__") return null;
    return items.find((item) => item.value === value);
  }, [value, items]);

  const displayValue = selectedItem
    ? selectedItem.label
    : value === "__none__"
      ? noneLabel
      : placeholder;

  const handleSelect = (selectedValue: string) => {
    if (selectedValue === value) {
      onValueChange("__none__");
    } else {
      onValueChange(selectedValue);
    }
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
              {allowNone && (
                <Command.Item
                  value="__none__"
                  onSelect={() => handleSelect("__none__")}
                >
                  <Flex justify="between" align="center" gap="2" width="100%">
                    <Text size={size} color="gray">
                      {noneLabel}
                    </Text>
                    <CheckIcon
                      className="mr-2 h-4 w-4"
                      style={{
                        opacity: value === "__none__" ? 1 : 0,
                      }}
                    />
                  </Flex>
                </Command.Item>
              )}
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
