import {
  ChartLineIcon,
  FileTextIcon,
  FlagIcon,
  FlaskIcon,
  FolderIcon,
  GithubLogoIcon,
  GitPullRequestIcon,
  TerminalIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Chip } from "@posthog/quill";
import { useSettingsStore as useFeatureSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { usePasteUndoStore } from "../pasteUndoStore";
import type {
  ChipType,
  MentionChipAttrs,
  MentionChipOptions,
} from "./MentionChipNode";

const chipBase = "group/chip relative top-px active:translate-y-0 pl-1";

const selectedRing = "border-ring/50 ring-[1px] ring-ring/50";

const typeIconMap: Record<ChipType, React.ComponentType<{ size: number }>> = {
  file: FileTextIcon,
  folder: FolderIcon,
  command: TerminalIcon,
  github_issue: GithubLogoIcon,
  github_pr: GitPullRequestIcon,
  error: WarningIcon,
  experiment: FlaskIcon,
  insight: ChartLineIcon,
  feature_flag: FlagIcon,
};

function IconCloseButton({
  type,
  onRemove,
}: {
  type: ChipType;
  onRemove: () => void;
}) {
  const Icon = typeIconMap[type] || FileTextIcon;

  return (
    <button
      type="button"
      tabIndex={-1}
      className="relative inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <span className="ease pointer-events-none absolute inset-0 flex items-center justify-center opacity-50 transition-opacity duration-150 group-hover/chip:opacity-0 motion-reduce:transition-none">
        <Icon size={10} />
      </span>
      <span className="ease pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100 motion-reduce:transition-none">
        <XIcon size={10} />
      </span>
    </button>
  );
}

function DefaultChip({
  type,
  id,
  label,
  chipId,
  pastedText,
  canExpandPastedText,
  selected,
  onRemove,
  onExpandPastedText,
}: {
  type: string;
  id: string;
  label: string;
  chipId: string | null;
  pastedText: boolean;
  canExpandPastedText: boolean;
  selected: boolean;
  onRemove: () => void;
  onExpandPastedText: () => void;
}) {
  const undoableChipId = usePasteUndoStore((state) => state.undoableChipId);
  const canUndoPaste =
    pastedText && chipId !== null && chipId === undoableChipId;
  const isCommand = type === "command";
  const prefix = isCommand ? "/" : "@";
  const isFile = type === "file";
  const isFolder = type === "folder";
  const isGithubRef = type === "github_issue" || type === "github_pr";
  const canOpenUrl = isGithubRef && /^https:\/\//.test(id);
  const isClickable = canOpenUrl || canExpandPastedText;

  const chipContent = (
    <Chip
      size="xs"
      contentEditable={false}
      onClick={
        canOpenUrl
          ? () => window.open(id, "_blank")
          : canExpandPastedText
            ? onExpandPastedText
            : undefined
      }
      className={`${chipBase} max-w-full whitespace-nowrap ${isClickable ? "cursor-pointer!" : "cursor-default! active:translate-y-0!"} ${isCommand ? "cli-slash-command" : "cli-file-mention"} ${selected ? selectedRing : ""}`}
    >
      <IconCloseButton type={type as ChipType} onRemove={onRemove} />
      {isGithubRef ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : (
        `${prefix}${label}`
      )}
    </Chip>
  );

  if (isFile || isFolder) {
    const tooltip = canExpandPastedText
      ? canUndoPaste
        ? "Click or paste again to expand as text"
        : "Click to expand as text"
      : id;
    return <Tooltip content={tooltip}>{chipContent}</Tooltip>;
  }

  return chipContent;
}

export function MentionChipView({
  node,
  getPos,
  editor,
  extension,
  selected,
}: NodeViewProps) {
  const { type, id, label, pastedText, chipId } =
    node.attrs as MentionChipAttrs;
  const { getPastedText, forgetPastedText } =
    extension.options as MentionChipOptions;
  const canExpandPastedText =
    pastedText && chipId != null && getPastedText(chipId) !== null;

  const handleRemove = () => {
    const pos = getPos();
    if (pos == null) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
    if (chipId) forgetPastedText(chipId);
  };

  const handleExpandPastedText = () => {
    if (!chipId) return;
    const content = getPastedText(chipId);
    if (content === null) return;

    const pos = getPos();
    if (pos == null) return;

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insertText(content, pos, pos + node.nodeSize);
        return true;
      })
      .run();
    forgetPastedText(chipId);
    usePasteUndoStore.getState().setUndoableChipId(null);
    useFeatureSettingsStore.getState().markHintLearned("paste-as-file");
  };

  return (
    <NodeViewWrapper as="span" className="inline">
      <DefaultChip
        type={type}
        id={id}
        label={label}
        chipId={chipId ?? null}
        pastedText={pastedText}
        canExpandPastedText={canExpandPastedText}
        selected={selected}
        onRemove={handleRemove}
        onExpandPastedText={handleExpandPastedText}
      />
    </NodeViewWrapper>
  );
}
