import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import {
  ArrowClockwise,
  PencilSimple,
  Plus,
  Trash,
  User,
} from "@phosphor-icons/react";
import { Box, Flex, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useEffect, useMemo, useState } from "react";
import { useMemoryEntries } from "../hooks/useMemoryEntries";
import {
  formatRelative,
  formatRelativeMs,
  parseMemoryMd,
  readSectionBody,
  renderMemoryMd,
  STANDARD_SECTIONS,
  setSection,
  stampSectionBody,
} from "../utils/memoryMd";
import {
  LongField,
  type PersonAnswer,
  PersonCard,
  parsePersonMd,
  renderPersonMd,
  slugify,
} from "./MemoryFields";

const MEMORY_FILE = "MEMORY.md";

interface PersonEntryLite {
  relativePath: string;
  name: string;
  description: string;
  mtimeMs: number;
}

export function MemoryHome() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: entries = [] } = useMemoryEntries();

  const { data: memoryMd } = useQuery(
    trpc.memory.get.queryOptions(
      { relativePath: MEMORY_FILE },
      { staleTime: 5_000 },
    ),
  );

  const writeMutation = useMutation(trpc.memory.write.mutationOptions());
  const deleteMutation = useMutation(trpc.memory.delete.mutationOptions());

  const parsed = useMemo(() => parseMemoryMd(memoryMd ?? ""), [memoryMd]);

  const people = useMemo<PersonEntryLite[]>(
    () =>
      entries
        .filter((e) => e.type === "person")
        .map((e) => ({
          relativePath: e.relativePath,
          name: e.name,
          description: e.description,
          mtimeMs: e.mtimeMs,
        })),
    [entries],
  );

  const memoryFileMtimeMs = useMemo(
    () => entries.find((e) => e.relativePath === MEMORY_FILE)?.mtimeMs ?? null,
    [entries],
  );

  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftPerson, setDraftPerson] = useState<PersonAnswer | null>(null);

  const saveSection = async (heading: string, body: string) => {
    try {
      const stamped = stampSectionBody(body);
      const next = setSection(parsed, heading, stamped);
      await writeMutation.mutateAsync({
        relativePath: MEMORY_FILE,
        content: renderMemoryMd(next),
      });
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
    } catch {
      toast.error("Failed to save");
      throw new Error("save failed");
    }
  };

  const startAddPerson = () => {
    setDraftPerson({
      id: crypto.randomUUID(),
      name: "",
      role: "",
      notes: "",
    });
    setEditingPath("__new__");
  };

  const startEditPerson = async (path: string) => {
    try {
      const content = await queryClient.fetchQuery(
        trpc.memory.get.queryOptions({ relativePath: path }),
      );
      const parsedPerson = parsePersonMd(content);
      setDraftPerson({
        id: crypto.randomUUID(),
        name: parsedPerson.name,
        role: parsedPerson.role,
        notes: parsedPerson.notes,
      });
      setEditingPath(path);
    } catch {
      toast.error("Failed to load person");
    }
  };

  const cancelPersonEdit = () => {
    setEditingPath(null);
    setDraftPerson(null);
  };

  const savePerson = async () => {
    if (!draftPerson || !draftPerson.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const targetPath =
      editingPath && editingPath !== "__new__"
        ? editingPath
        : `people/${slugify(draftPerson.name)}.md`;
    try {
      await writeMutation.mutateAsync({
        relativePath: targetPath,
        content: renderPersonMd(draftPerson),
      });
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      cancelPersonEdit();
    } catch {
      toast.error("Failed to save person");
    }
  };

  const removePerson = async (path: string) => {
    if (!window.confirm("Remove this person?")) return;
    try {
      await deleteMutation.mutateAsync({ relativePath: path });
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
    } catch {
      toast.error("Failed to remove");
    }
  };

  return (
    <ScrollArea type="auto" className="h-full">
      <Box className="mx-auto max-w-3xl px-6 py-6">
        {/* People — prominent, top */}
        <SectionHeader title="People" />
        <Text className="mb-3 block text-[12px] text-gray-10">
          The agent uses this list to decode names and understand who's involved
          in what.
        </Text>

        <Flex direction="column" gap="2" className="mb-3">
          {people.length === 0 && editingPath !== "__new__" && (
            <Box className="rounded border border-gray-5 border-dashed px-4 py-6 text-center">
              <Text className="text-[13px] text-gray-10">
                No people yet — add the folks you work with most.
              </Text>
            </Box>
          )}

          {people.map((p) =>
            editingPath === p.relativePath && draftPerson ? (
              <Box key={p.relativePath}>
                <PersonCard
                  person={draftPerson}
                  onChange={(patch) =>
                    setDraftPerson((prev) =>
                      prev ? { ...prev, ...patch } : prev,
                    )
                  }
                  onRemove={() => removePerson(p.relativePath)}
                />
                <Flex justify="end" gap="2" className="mt-2">
                  <button
                    type="button"
                    onClick={cancelPersonEdit}
                    className="rounded px-2 py-1 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-11"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={savePerson}
                    disabled={writeMutation.isPending}
                    className="rounded bg-gray-12 px-3 py-1 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-40"
                  >
                    Save
                  </button>
                </Flex>
              </Box>
            ) : (
              <PersonRow
                key={p.relativePath}
                person={p}
                onEdit={() => startEditPerson(p.relativePath)}
                onRemove={() => removePerson(p.relativePath)}
              />
            ),
          )}

          {editingPath === "__new__" && draftPerson && (
            <Box>
              <PersonCard
                person={draftPerson}
                onChange={(patch) =>
                  setDraftPerson((prev) =>
                    prev ? { ...prev, ...patch } : prev,
                  )
                }
                onRemove={cancelPersonEdit}
              />
              <Flex justify="end" gap="2" className="mt-2">
                <button
                  type="button"
                  onClick={cancelPersonEdit}
                  className="rounded px-2 py-1 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-11"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={savePerson}
                  disabled={writeMutation.isPending}
                  className="rounded bg-gray-12 px-3 py-1 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-40"
                >
                  Add person
                </button>
              </Flex>
            </Box>
          )}
        </Flex>

        {editingPath !== "__new__" && (
          <button
            type="button"
            onClick={startAddPerson}
            className="mb-8 flex items-center gap-1.5 rounded border border-gray-5 border-dashed px-3 py-2 text-[12px] text-gray-10 hover:border-gray-7 hover:text-gray-11"
          >
            <Plus size={12} />
            Add person
          </button>
        )}

        <Divider />

        <EditableSection
          title="You"
          heading={STANDARD_SECTIONS.me}
          body={parsed.sections.get(STANDARD_SECTIONS.me) ?? ""}
          placeholder="Your role, where you're based, when you joined. Bullets work great."
          onSave={(b) => saveSection(STANDARD_SECTIONS.me, b)}
          fallbackMtimeMs={memoryFileMtimeMs}
        />

        <EditableSection
          title="Current focus"
          heading={STANDARD_SECTIONS.focus}
          body={parsed.sections.get(STANDARD_SECTIONS.focus) ?? ""}
          placeholder="What you're driving vs watching. Drop links to dashboards, docs, issues."
          onSave={(b) => saveSection(STANDARD_SECTIONS.focus, b)}
          fallbackMtimeMs={memoryFileMtimeMs}
        />

        <EditableSection
          title="Glossary"
          heading={STANDARD_SECTIONS.glossary}
          body={parsed.sections.get(STANDARD_SECTIONS.glossary) ?? ""}
          placeholder={`Decoder ring for shorthand. Markdown tables work great:\n\n| Term | Meaning |\n|------|---------|\n| ARR | Annual Recurring Revenue |\n| BDR | Business Development Rep |`}
          onSave={(b) => saveSection(STANDARD_SECTIONS.glossary, b)}
          fallbackMtimeMs={memoryFileMtimeMs}
        />

        <EditableSection
          title="Working style"
          heading={STANDARD_SECTIONS.workingStyle}
          body={parsed.sections.get(STANDARD_SECTIONS.workingStyle) ?? ""}
          placeholder={`e.g. "Tuesdays meeting-free", "prefer async over meetings", timezone.`}
          onSave={(b) => saveSection(STANDARD_SECTIONS.workingStyle, b)}
          fallbackMtimeMs={memoryFileMtimeMs}
        />

        <EditableSection
          title="Where to find things"
          heading={STANDARD_SECTIONS.findThings}
          body={parsed.sections.get(STANDARD_SECTIONS.findThings) ?? ""}
          placeholder="Handbook URL, key Slack channels, recurring meetings — links welcome."
          onSave={(b) => saveSection(STANDARD_SECTIONS.findThings, b)}
          fallbackMtimeMs={memoryFileMtimeMs}
        />

        {/* Render any unknown sections so user-written content isn't hidden. */}
        {parsed.sectionOrder
          .filter(
            (h) =>
              !Object.values(STANDARD_SECTIONS).includes(
                h as (typeof STANDARD_SECTIONS)[keyof typeof STANDARD_SECTIONS],
              ),
          )
          .map((heading) => (
            <EditableSection
              key={heading}
              title={heading}
              heading={heading}
              body={parsed.sections.get(heading) ?? ""}
              placeholder=""
              onSave={(b) => saveSection(heading, b)}
              fallbackMtimeMs={memoryFileMtimeMs}
            />
          ))}
      </Box>
    </ScrollArea>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="mb-1 block font-medium text-[16px] text-gray-12">
      {title}
    </Text>
  );
}

function Divider() {
  return <Box className="my-6 border-t border-t-(--gray-5)" />;
}

function PersonRow({
  person,
  onEdit,
  onRemove,
}: {
  person: PersonEntryLite;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <Flex
      align="center"
      gap="3"
      className="group rounded border border-gray-5 bg-gray-2 px-3 py-2 hover:border-gray-7"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-4">
        <User size={13} className="text-gray-11" />
      </span>
      <Flex direction="column" className="min-w-0 flex-1">
        <Flex align="baseline" gap="2" className="min-w-0">
          <Text className="truncate font-medium text-[13px] text-gray-12">
            {person.name}
          </Text>
          <Tooltip
            content={`Last modified ${new Date(person.mtimeMs).toLocaleString()}`}
            side="top"
          >
            <Text className="shrink-0 text-[11px] text-gray-9">
              · {formatRelativeMs(person.mtimeMs)}
            </Text>
          </Tooltip>
        </Flex>
        {person.description && (
          <Text className="truncate text-[12px] text-gray-10">
            {person.description}
          </Text>
        )}
      </Flex>
      <Flex
        align="center"
        gap="1"
        className="opacity-0 group-hover:opacity-100"
      >
        <Tooltip content="Edit" side="top">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 text-gray-10 hover:bg-gray-4 hover:text-gray-12"
          >
            <PencilSimple size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Remove" side="top">
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-gray-10 hover:bg-gray-4 hover:text-gray-12"
          >
            <Trash size={12} />
          </button>
        </Tooltip>
      </Flex>
    </Flex>
  );
}

function EditableSection({
  title,
  body,
  placeholder,
  fallbackMtimeMs,
  onSave,
}: {
  title: string;
  heading: string;
  body: string;
  placeholder: string;
  fallbackMtimeMs: number | null;
  onSave: (body: string) => Promise<void>;
}) {
  const { visible, lastEdited } = useMemo(() => readSectionBody(body), [body]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(visible);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(visible);
  }, [visible, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // toast already shown by caller
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(visible);
    setEditing(false);
  };

  const isEmpty = visible.length === 0;

  return (
    <Box className="mb-6">
      <Flex align="center" justify="between" gap="2" className="mb-2">
        <Flex align="baseline" gap="2" className="min-w-0">
          <Text className="font-medium text-[14px] text-gray-12">{title}</Text>
          {lastEdited && (
            <Tooltip content={`Edited ${lastEdited}`} side="top">
              <Text className="text-[11px] text-gray-9">
                · {formatRelative(lastEdited)}
              </Text>
            </Tooltip>
          )}
          {!lastEdited && !isEmpty && fallbackMtimeMs != null && (
            <Tooltip
              content={`Last modified ${new Date(fallbackMtimeMs).toLocaleString()}`}
              side="top"
            >
              <Text className="text-[11px] text-gray-9">
                · {formatRelativeMs(fallbackMtimeMs)}
              </Text>
            </Tooltip>
          )}
        </Flex>
        <Flex align="center" gap="1">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-10 hover:bg-gray-3 hover:text-gray-12"
            >
              <PencilSimple size={11} />
              {isEmpty ? "Add" : "Edit"}
            </button>
          )}
        </Flex>
      </Flex>

      {editing ? (
        <Box>
          <LongField
            value={draft}
            onChange={setDraft}
            placeholder={placeholder}
            rows={5}
          />
          <Flex justify="end" gap="2" className="mt-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded px-2 py-1 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-11"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 rounded bg-gray-12 px-3 py-1 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-40"
            >
              {saving && <ArrowClockwise size={10} className="animate-spin" />}
              Save
            </button>
          </Flex>
        </Box>
      ) : isEmpty ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block w-full rounded border border-gray-5 border-dashed px-3 py-3 text-left text-[12px] text-gray-9 hover:border-gray-7 hover:text-gray-10"
        >
          {placeholder || `Add ${title.toLowerCase()}…`}
        </button>
      ) : (
        <Box className="rounded border border-gray-5 bg-gray-1 px-4 py-3 text-[13px]">
          <MarkdownRenderer content={visible} />
        </Box>
      )}
    </Box>
  );
}
