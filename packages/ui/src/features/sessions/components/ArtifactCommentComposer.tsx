import { PaperPlaneRightIcon, XIcon } from "@phosphor-icons/react";
import { InputGroupAddon, InputGroupButton } from "@posthog/quill";
import { splitMentionSegments } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { MentionComposer } from "@posthog/ui/features/canvas/components/MentionComposer";

export function mentionIdsFromContent(
  content: string,
  members: UserBasic[],
): number[] {
  const emails = new Set(
    splitMentionSegments(content).flatMap((segment) =>
      segment.type === "mention" ? [segment.email.toLowerCase()] : [],
    ),
  );
  return members
    .filter((member) => emails.has(member.email.toLowerCase()))
    .map((member) => member.id);
}

export function ArtifactCommentComposer({
  value,
  onValueChange,
  onSubmit,
  onCancel,
  members,
  placeholder,
  rows = 3,
  disabled = false,
  submitLabel = "Comment",
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (content: string, mentions: number[]) => void;
  onCancel?: () => void;
  members: UserBasic[];
  placeholder: string;
  rows?: number;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const submit = () => {
    const content = value.trim();
    if (!content || disabled) return;
    onSubmit(content, mentionIdsFromContent(content, members));
  };

  return (
    <MentionComposer
      value={value}
      onValueChange={onValueChange}
      onSubmit={submit}
      members={members}
      placeholder={placeholder}
      rows={rows}
      inputClassName="max-h-40 text-[13px]"
    >
      <InputGroupAddon align="block-end" className="p-1">
        {onCancel && (
          <InputGroupButton
            size="icon-sm"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <XIcon />
          </InputGroupButton>
        )}
        <span className="ml-auto">
          <InputGroupButton
            variant="primary"
            size="icon-sm"
            aria-label={submitLabel}
            disabled={!value.trim() || disabled}
            onClick={submit}
          >
            <PaperPlaneRightIcon />
          </InputGroupButton>
        </span>
      </InputGroupAddon>
    </MentionComposer>
  );
}
