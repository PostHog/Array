import { useTaskStore } from "@features/tasks/stores/taskStore";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Flex, Kbd, TextField } from "@radix-ui/themes";

interface TaskFilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function getMenuItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[role="menuitem"]'),
  ) as HTMLElement[];
}

function highlightMenuItem(index: number) {
  const menuItems = getMenuItems();
  menuItems.forEach((item, i) => {
    if (i === index) {
      item.setAttribute("data-highlighted", "");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.removeAttribute("data-highlighted");
    }
  });
}

export function TaskFilterSearch({
  value,
  onChange,
  placeholder = "Filter...",
}: TaskFilterSearchProps) {
  const selectedIndex = useTaskStore((state) => state.filterMenuSelectedIndex);
  const setSelectedIndex = useTaskStore(
    (state) => state.setFilterMenuSelectedIndex,
  );

  const handleChange = (newValue: string) => {
    onChange(newValue);
    setTimeout(() => {
      const menuItems = getMenuItems();
      if (newValue.trim().length > 0 && menuItems.length > 0) {
        setSelectedIndex(0);
        highlightMenuItem(0);
      } else {
        setSelectedIndex(-1);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const menuItems = getMenuItems();

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const nextIndex = selectedIndex + 1;
      if (nextIndex < menuItems.length) {
        setSelectedIndex(nextIndex);
        highlightMenuItem(nextIndex);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const prevIndex = selectedIndex - 1;
      if (prevIndex >= 0) {
        setSelectedIndex(prevIndex);
        highlightMenuItem(prevIndex);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIndex >= 0 && menuItems[selectedIndex]) {
        menuItems[selectedIndex].click();
      }
      return;
    }

    if (e.key === "Escape") {
      return;
    }

    e.stopPropagation();
  };

  return (
    <Flex mb="2">
      <TextField.Root
        size="1"
        value={value}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        placeholder={placeholder}
        style={{ width: "100%" }}
        autoFocus
        onKeyDown={handleKeyDown}
      >
        <TextField.Slot>
          <MagnifyingGlassIcon height="12 " width="12" />
        </TextField.Slot>
        <TextField.Slot>
          <Kbd>F</Kbd>
        </TextField.Slot>
      </TextField.Root>
    </Flex>
  );
}
