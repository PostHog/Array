import {
  FileText,
  GaugeIcon,
  GithubLogo,
  NoteIcon,
  Plus,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { NewTileInput, TileType } from "@shared/types/work-projects";
import { type ComponentType, useEffect, useRef, useState } from "react";

interface AddTileMenuProps {
  onAdd: (tile: NewTileInput) => void;
}

interface TileTypeOption {
  type: Exclude<TileType, "title">;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; weight?: "duotone" | "regular" }>;
  factory: () => NewTileInput;
}

const CONTENT_OPTIONS: TileTypeOption[] = [
  {
    type: "note",
    label: "Note",
    description: "Quick thought, in five colours.",
    icon: NoteIcon,
    factory: () => ({ type: "note", body: "", tone: "yellow", size: "sm" }),
  },
  {
    type: "file",
    label: "Files",
    description: "List of files on your computer.",
    icon: FileText,
    factory: () => ({
      type: "file",
      items: [],
      size: "md",
    }),
  },
];

const POSTHOG_OPTIONS: TileTypeOption[] = [
  {
    type: "headline",
    label: "Headline metric",
    description: "Big number with a live sparkline.",
    icon: GaugeIcon,
    factory: () => ({
      type: "headline",
      label: "Headline metric",
      fallbackValue: "–",
      fallbackDelta: "Set a target",
      fallbackSparkline: [0, 0, 0, 0, 0],
      size: "md",
    }),
  },
];

const WORK_OPTIONS: TileTypeOption[] = [
  {
    type: "github_activity",
    label: "GitHub activity",
    description: "Summary of a repo's PRs, issues, and releases.",
    icon: GithubLogo,
    factory: () => ({
      type: "github_activity",
      enabledTypes: ["pr_merged", "pr_opened", "issue_opened", "release"],
      windowDays: 7,
      size: "lg",
    }),
  },
];

function Section({
  label,
  options,
  onPick,
}: {
  label: string;
  options: TileTypeOption[];
  onPick: (opt: TileTypeOption) => void;
}) {
  return (
    <Box className="px-2 pt-2 pb-1">
      <Text
        as="div"
        className="px-1 pb-1.5 text-(--gray-10) text-[10px] uppercase tracking-wide"
      >
        {label}
      </Text>
      <Flex direction="column" gap="1">
        {options.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              type="button"
              key={opt.type + opt.label}
              onClick={() => onPick(opt)}
              className="flex items-start gap-2.5 rounded-(--radius-2) px-2 py-1.5 text-left transition-colors hover:bg-(--gray-3)"
            >
              <Box className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-2) bg-(--gray-3) text-(--gray-11)">
                <Icon size={14} weight="duotone" />
              </Box>
              <Box className="min-w-0 flex-1">
                <Text
                  as="div"
                  weight="medium"
                  className="text-(--gray-12) text-[13px] leading-tight"
                >
                  {opt.label}
                </Text>
                <Text
                  as="div"
                  className="text-(--gray-11) text-[11px] leading-snug"
                >
                  {opt.description}
                </Text>
              </Box>
            </button>
          );
        })}
      </Flex>
    </Box>
  );
}

export function AddTileMenu({ onAdd }: AddTileMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const pick = (opt: TileTypeOption) => {
    onAdd(opt.factory());
    setOpen(false);
  };

  return (
    <Box className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
      >
        <Plus size={12} weight="bold" />
        Add tile
      </button>
      {open && (
        <Box className="absolute top-9 right-0 z-20 w-[320px] overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) shadow-lg">
          <Section label="Content" options={CONTENT_OPTIONS} onPick={pick} />
          <Box className="mx-2 border-(--gray-4) border-t" />
          <Section label="PostHog" options={POSTHOG_OPTIONS} onPick={pick} />
          <Box className="mx-2 border-(--gray-4) border-t" />
          <Section label="Work" options={WORK_OPTIONS} onPick={pick} />
        </Box>
      )}
    </Box>
  );
}
