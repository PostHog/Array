import {
  ArrowLeft,
  DotsThree,
  Hash,
  PushPin,
  PushPinSlash,
  TrashSimple,
} from "@phosphor-icons/react";
import { Box, Flex } from "@radix-ui/themes";
import type {
  ProjectIconId,
  ProjectMember,
  WorkProject,
} from "@shared/types/work-projects";
import { toast } from "@utils/toast";
import { useCallback, useEffect, useRef, useState } from "react";
import { PROJECT_ICON_MAP, PROJECT_ICON_OPTIONS } from "../canvas/icons";

interface ProjectHeaderProps {
  project: WorkProject;
  onBack: () => void;
  onUpdateTitle: (patch: {
    name?: string;
    tagline?: string;
    iconId?: ProjectIconId;
  }) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onTogglePin: (pinned: boolean) => Promise<void> | void;
}

export function ProjectHeader({
  project,
  onBack,
  onUpdateTitle,
  onDelete,
  onTogglePin,
}: ProjectHeaderProps) {
  const isPinned = !!project.pinnedAt;
  const Icon = PROJECT_ICON_MAP[project.iconId] ?? PROJECT_ICON_MAP.lightbulb;

  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<null | "name" | "tagline">(null);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [taglineDraft, setTaglineDraft] = useState(project.tagline);

  const iconRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const taglineInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNameDraft(project.name), [project.name]);
  useEffect(() => setTaglineDraft(project.tagline), [project.tagline]);

  useEffect(() => {
    if (editing === "name") nameInputRef.current?.select();
    if (editing === "tagline") taglineInputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!iconPickerOpen) return;
    const handle = (e: MouseEvent) => {
      if (iconRef.current && !iconRef.current.contains(e.target as Node)) {
        setIconPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [iconPickerOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  const commitName = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== project.name) {
      void onUpdateTitle({ name: trimmed });
    } else {
      setNameDraft(project.name);
    }
    setEditing(null);
  }, [nameDraft, project.name, onUpdateTitle]);

  const commitTagline = useCallback(() => {
    const trimmed = taglineDraft.trim();
    if (trimmed !== project.tagline) {
      void onUpdateTitle({ tagline: trimmed });
    } else {
      setTaglineDraft(project.tagline);
    }
    setEditing(null);
  }, [taglineDraft, project.tagline, onUpdateTitle]);

  const handleCopyShare = useCallback(() => {
    const lines = [
      `*${project.name}*`,
      project.tagline ? `_${project.tagline}_` : null,
      "",
      ...project.tiles
        .filter((t) => t.type !== "title")
        .map((t) => {
          if (t.type === "note") return `• ${t.body.split("\n")[0] || "Note"}`;
          if (t.type === "headline") return `• ${t.label}`;
          if (t.type === "insight") return `• ${t.title}`;
          if (t.type === "file") {
            const label = t.title ?? "Files";
            return `• ${label} (${t.items.length})`;
          }
          return null;
        })
        .filter(Boolean),
    ]
      .filter((v) => v !== null)
      .join("\n");
    void navigator.clipboard
      .writeText(lines)
      .then(() =>
        toast.success("Project summary copied", {
          description: "Paste it into Slack or anywhere else.",
        }),
      )
      .catch(() => toast.error("Couldn't copy to clipboard"));
    setMenuOpen(false);
  }, [project]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    void onDelete();
  }, [onDelete]);

  return (
    <Flex
      align="center"
      gap="3"
      className="shrink-0 border-(--gray-5) border-b bg-(--gray-1) px-6 py-3"
    >
      <button
        type="button"
        onClick={onBack}
        title="Back to projects"
        aria-label="Back to projects"
        className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
      >
        <ArrowLeft size={14} weight="bold" />
      </button>

      <Box ref={iconRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setIconPickerOpen((v) => !v)}
          aria-label="Change icon"
          className="flex h-9 w-9 items-center justify-center rounded-(--radius-2) bg-(--gray-3) text-(--gray-12) transition-colors hover:bg-(--gray-4)"
        >
          <Icon size={18} weight="regular" />
        </button>
        {iconPickerOpen && (
          <Box className="absolute top-11 left-0 z-20 grid grid-cols-5 gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) p-2 shadow-lg">
            {PROJECT_ICON_OPTIONS.map((id) => {
              const Opt = PROJECT_ICON_MAP[id];
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => {
                    void onUpdateTitle({ iconId: id });
                    setIconPickerOpen(false);
                  }}
                  aria-label={`Use ${id} icon`}
                  className={`flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-11) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12) ${
                    id === project.iconId
                      ? "bg-(--gray-3) text-(--gray-12) ring-(--gray-7) ring-1"
                      : ""
                  }`}
                >
                  <Opt size={16} weight="regular" />
                </button>
              );
            })}
          </Box>
        )}
      </Box>

      <Box className="min-w-0 flex-1">
        {editing === "name" ? (
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setNameDraft(project.name);
                setEditing(null);
              }
            }}
            className="-mx-1 block w-full rounded-(--radius-2) bg-(--gray-2) px-1.5 py-0.5 font-medium text-(--gray-12) text-[16px] outline-none ring-(--accent-7) ring-1 focus:ring-(--accent-8) focus:ring-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("name")}
            className="-mx-1 block max-w-full truncate rounded-(--radius-2) px-1.5 py-0.5 text-left font-medium text-(--gray-12) text-[16px] hover:bg-(--gray-3)"
          >
            {project.name}
          </button>
        )}
        {editing === "tagline" ? (
          <input
            ref={taglineInputRef}
            value={taglineDraft}
            onChange={(e) => setTaglineDraft(e.target.value)}
            onBlur={commitTagline}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTagline();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTaglineDraft(project.tagline);
                setEditing(null);
              }
            }}
            placeholder="Add a tagline"
            className="-mx-1 mt-0.5 block w-full rounded-(--radius-2) bg-(--gray-2) px-1.5 py-0.5 text-(--gray-11) text-[12px] outline-none ring-(--accent-7) ring-1 focus:ring-(--accent-8) focus:ring-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("tagline")}
            className="-mx-1 mt-0.5 block max-w-full truncate rounded-(--radius-2) px-1.5 py-0.5 text-left text-(--gray-11) text-[12px] hover:bg-(--gray-3)"
          >
            {project.tagline || "Add a tagline"}
          </button>
        )}
      </Box>

      <MembersStack members={project.members} />

      <Box ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Project actions"
          className="flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-11) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          <DotsThree size={16} weight="bold" />
        </button>
        {menuOpen && (
          <Box className="absolute top-9 right-0 z-20 w-52 overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void onTogglePin(!isPinned);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--gray-12) text-[12px] hover:bg-(--gray-3)"
            >
              {isPinned ? (
                <PushPinSlash size={12} weight="bold" />
              ) : (
                <PushPin size={12} weight="bold" />
              )}
              {isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
            </button>
            <button
              type="button"
              onClick={handleCopyShare}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--gray-12) text-[12px] hover:bg-(--gray-3)"
            >
              <Hash size={12} weight="bold" />
              Copy for Slack
            </button>
            <Box className="border-(--gray-4) border-t" />
            <button
              type="button"
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--red-11) text-[12px] hover:bg-(--red-3)"
            >
              <TrashSimple size={12} weight="bold" />
              Delete project
            </button>
          </Box>
        )}
      </Box>
    </Flex>
  );
}

function MembersStack({ members }: { members: ProjectMember[] }) {
  if (members.length === 0) return null;
  const shown = members.slice(0, 4);
  const rest = members.length - shown.length;
  return (
    <Flex align="center" className="shrink-0">
      {shown.map((m, i) => (
        <Box
          key={`${m.name}-${i}`}
          title={m.name}
          style={{ zIndex: members.length - i }}
          className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-(--gray-1) bg-(--gray-4) text-(--gray-12) text-[10px] first:ml-0"
        >
          {m.initials}
        </Box>
      ))}
      {rest > 0 && (
        <Box className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-(--gray-1) bg-(--gray-3) text-(--gray-11) text-[10px]">
          +{rest}
        </Box>
      )}
    </Flex>
  );
}
