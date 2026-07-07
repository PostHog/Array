import {
  Avatar,
  AvatarFallback,
  InputGroup,
  InputGroupTextarea,
} from "@posthog/quill";
import type { UserBasic } from "@posthog/shared/domain-types";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import {
  type ActiveMentionQuery,
  applyMention,
  filterMentionCandidates,
  findMentionQuery,
} from "@posthog/ui/features/canvas/utils/mentionComposer";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { Text } from "@radix-ui/themes";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

interface MentionComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Fired on Enter (without Shift) while the suggestion popup is closed. */
  onSubmit: () => void;
  /** The taggable pool; typically the org's members. */
  members: UserBasic[];
  onMentionInsert?: (member: UserBasic) => void;
  placeholder?: string;
  rows?: number;
  textareaClassName?: string;
  /** Rendered inside the input group after the textarea (send button etc.). */
  children?: ReactNode;
}

/**
 * The thread composer: a textarea that opens an @-mention typeahead over the
 * org's members. Selecting a member inserts an inline mention token (see
 * `@posthog/shared` mentions) that notifies them in the Activity page.
 */
export function MentionComposer({
  value,
  onValueChange,
  onSubmit,
  members,
  onMentionInsert,
  placeholder,
  rows,
  textareaClassName,
  children,
}: MentionComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState<ActiveMentionQuery | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Esc hides the popup for the current trigger; typing a new `@` re-arms it.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);

  const syncActive = useCallback((el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    setActive(findMentionQuery(el.value, caret));
  }, []);

  const suggestions = useMemo(
    () => (active ? filterMentionCandidates(members, active.query) : []),
    [active, members],
  );
  const open =
    !!active && active.start !== dismissedStart && suggestions.length > 0;

  // Render-time adjustments (ref-guarded, same idiom as SuggestionList): when
  // the parent clears the draft the mention context goes with it, and a new
  // query restarts keyboard selection at the top.
  const prevValueRef = useRef(value);
  if (prevValueRef.current !== value) {
    prevValueRef.current = value;
    if (!value) {
      setActive(null);
      setDismissedStart(null);
    }
  }
  const activeKey = active ? `${active.start}:${active.query}` : "";
  const prevActiveKeyRef = useRef(activeKey);
  if (prevActiveKeyRef.current !== activeKey) {
    prevActiveKeyRef.current = activeKey;
    if (selectedIndex !== 0) setSelectedIndex(0);
  }
  // The list can shrink while a lower row is selected (members filter down).
  const highlightedIndex = Math.min(
    selectedIndex,
    Math.max(0, suggestions.length - 1),
  );

  const insert = useCallback(
    (member: UserBasic) => {
      const el = textareaRef.current;
      if (!el || !active) return;
      const caret = el.selectionStart ?? value.length;
      const result = applyMention(value, active, caret, member);
      onValueChange(result.text);
      setActive(null);
      onMentionInsert?.(member);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(result.caret, result.caret);
      });
    },
    [active, value, onValueChange, onMentionInsert],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : suggestions.length - 1;
        const next = (highlightedIndex + delta) % suggestions.length;
        setSelectedIndex(next);
        itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const member = suggestions[highlightedIndex];
        if (member) insert(member);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedStart(active.start);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      {open && (
        <div className="absolute inset-x-0 bottom-full z-50 mb-1 flex flex-col overflow-hidden rounded-md border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] text-[13px] shadow-lg">
          <div
            role="listbox"
            aria-label="Mention a teammate"
            className="max-h-56 overflow-y-auto py-1"
          >
            {suggestions.map((member, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                key={member.uuid}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                // Keep focus in the textarea so insertion lands at the caret.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(member)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-2 border-none px-2 py-1 text-left ${
                  index === highlightedIndex ? "bg-[var(--accent-a4)]" : ""
                }`}
              >
                <Avatar size="xs" className="shrink-0">
                  <AvatarFallback>{getUserInitials(member)}</AvatarFallback>
                </Avatar>
                <Text size="1" weight="medium" className="truncate">
                  {userDisplayName(member)}
                </Text>
                <Text
                  size="1"
                  className="ml-auto shrink-0 truncate text-muted-foreground"
                >
                  {member.email}
                </Text>
              </button>
            ))}
          </div>
        </div>
      )}
      <InputGroup className="h-auto cursor-text bg-card">
        <InputGroupTextarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            syncActive(event.target);
          }}
          onSelect={(event) => syncActive(event.currentTarget)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          className={textareaClassName}
        />
        {children}
      </InputGroup>
    </div>
  );
}
