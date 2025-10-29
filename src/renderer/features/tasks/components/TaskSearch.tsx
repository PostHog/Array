import { useTaskStore } from "@features/tasks/stores/taskStore";
import { Cross2Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { IconButton, Kbd, TextField } from "@radix-ui/themes";
import { useEffect, useRef } from "react";

interface TaskSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function TaskSearch({ value, onChange }: TaskSearchProps) {
  const isExpanded = useTaskStore((state) => state.isSearchExpanded);
  const setIsExpanded = useTaskStore((state) => state.setIsSearchExpanded);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldBeExpanded = isExpanded || value.length > 0;

  const handleExpand = () => {
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleClear = () => {
    onChange("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    if (value.length === 0) {
      setIsExpanded(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setIsExpanded]);

  return (
    <div
      className="transition-all duration-200"
      style={{
        width: shouldBeExpanded ? "250px" : "32px",
      }}
    >
      {!shouldBeExpanded ? (
        <IconButton
          size="1"
          variant="outline"
          color="gray"
          onClick={handleExpand}
          type="button"
          title="Search tasks (⌘F)"
        >
          <MagnifyingGlassIcon />
        </IconButton>
      ) : (
        <TextField.Root
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Search tasks..."
          size="1"
        >
          <TextField.Slot>
            <MagnifyingGlassIcon height="12" width="12" />
          </TextField.Slot>
          {value ? (
            <TextField.Slot>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={handleClear}
                type="button"
              >
                <Cross2Icon width="12" height="12" />
              </IconButton>
            </TextField.Slot>
          ) : (
            <TextField.Slot>
              <Kbd>⌘F</Kbd>
            </TextField.Slot>
          )}
        </TextField.Root>
      )}
    </div>
  );
}
