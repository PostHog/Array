import { Check } from "@phosphor-icons/react";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
} from "@posthog/quill";
import { Popover, Text } from "@radix-ui/themes";
import { useState } from "react";

interface ProjectSelectProps {
  projectId: number;
  projectName: string;
  projects: Array<{ id: number; name: string }>;
  onProjectChange: (projectId: number) => void;
  disabled?: boolean;
  size?: "1" | "2";
}

type ProjectInfo = { id: number; name: string };

export function ProjectSelect({
  projectId,
  projectName,
  projects,
  onProjectChange,
  disabled = false,
  size = "2",
}: ProjectSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sizeClass = size === "1" ? "text-[13px]" : "text-sm";

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  };

  const handleSelect = (id: string | null) => {
    if (id === null) return;
    const next = Number(id);
    if (Number.isNaN(next)) return;
    onProjectChange(next);
    // Route through handleOpenChange so setQuery("") fires — calling
    // setOpen(false) directly bypasses Popover's onOpenChange.
    handleOpenChange(false);
  };

  if (projects.length <= 1) {
    return (
      <Text className={`text-(--gray-12) opacity-50 ${sizeClass}`}>
        {projectName}
      </Text>
    );
  }

  return (
    <Text className={sizeClass}>
      <span className="text-(--gray-12) opacity-50">
        {projectName}
        {" · "}
      </span>
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger>
          <button
            type="button"
            disabled={disabled}
            style={{
              cursor: disabled ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              fontSize: "inherit",
              opacity: disabled ? 0.5 : 1,
            }}
            className="border-0 bg-transparent p-0 font-medium text-(--accent-9)"
          >
            change
          </button>
        </Popover.Trigger>
        <Popover.Content
          className="w-[320px] gap-0 border border-(--gray-6) bg-(--color-panel-solid) p-0 shadow-6"
          side="bottom"
          align="start"
          sideOffset={8}
        >
          <Autocomplete<ProjectInfo>
            inline
            defaultOpen
            items={projects}
            value={query}
            autoHighlight="always"
            onValueChange={(val, eventDetails) => {
              if (eventDetails.reason !== "input-change") return;
              if (typeof val === "string") setQuery(val);
            }}
            filter={(project, q) => {
              if (!q) return true;
              return project.name.toLowerCase().includes(q.toLowerCase());
            }}
          >
            <AutocompleteInput
              placeholder="Search projects…"
              autoFocus
              showClear
            />
            <AutocompleteStatus
              emptyContent={
                query ? (
                  <span>
                    No projects match <strong>"{query}"</strong>
                  </span>
                ) : (
                  <span>No projects available</span>
                )
              }
            />
            <AutocompleteList className="max-h-[240px] pt-1">
              {(project: ProjectInfo) => (
                <AutocompleteItem
                  key={project.id}
                  value={String(project.id)}
                  onClick={() => handleSelect(String(project.id))}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-sm">{project.name}</span>
                  {project.id === projectId && (
                    <Check size={14} className="text-accent-11" />
                  )}
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </Autocomplete>
        </Popover.Content>
      </Popover.Root>
    </Text>
  );
}
