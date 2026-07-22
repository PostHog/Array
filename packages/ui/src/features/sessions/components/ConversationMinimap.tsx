import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@posthog/quill";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";

export interface MinimapMessage {
  id: string;
  preview: string;
}

const PREVIEW_MAX_LENGTH = 80;

/** User messages reduced to what a minimap marker needs: id + one-line preview. */
export function toMinimapMessages(items: ConversationItem[]): MinimapMessage[] {
  const result: MinimapMessage[] = [];
  for (const item of items) {
    if (item.type !== "user_message") continue;
    const singleLine = item.content.replace(/\s+/g, " ").trim();
    result.push({
      id: item.id,
      preview:
        singleLine.length <= PREVIEW_MAX_LENGTH
          ? singleLine
          : `${singleLine.slice(0, PREVIEW_MAX_LENGTH)}…`,
    });
  }
  return result;
}

/** Vertical budget per marker; the rail compresses below this once it hits full height. */
const MARKER_SPACING = 16;

interface ConversationMinimapProps {
  messages: MinimapMessage[];
  /** Message the view is currently anchored to; its marker is accented. */
  activeId?: string | null;
  onSelect: (id: string) => void;
}

/**
 * Clickable minimap of the user's messages, docked to the thread's right edge (just left of the
 * scrollbar). One marker per user message, spread top-to-bottom in conversation order — like
 * editor minimap annotations, position maps to "how far into the conversation", not pixel
 * offsets. Hover previews the message; click scrolls to it.
 *
 * Rendered as an overlay inside the thread's positioning context (same convention as the
 * scroll-to-bottom button): `pointer-events-none` everywhere except the markers, so the empty
 * strip never blocks the content underneath.
 */
export function ConversationMinimap({
  messages,
  activeId,
  onSelect,
}: ConversationMinimapProps) {
  // With one message there is nowhere to jump; skip the rail entirely.
  if (messages.length < 2) return null;

  return (
    <nav
      aria-label="Conversation minimap"
      className="pointer-events-none absolute inset-y-3 right-2.5 z-10 flex w-4 items-center"
    >
      <div
        className="relative h-full w-full"
        // Short conversations get a compact centered rail instead of markers pinned to the
        // pane's far corners; long ones use the full height.
        style={{ maxHeight: messages.length * MARKER_SPACING }}
      >
        {messages.map((message, index) => {
          const isActive = message.id === activeId;
          return (
            <Tooltip key={message.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Jump to message ${index + 1} of ${messages.length}: ${message.preview}`}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelect(message.id)}
                    className="group -translate-y-1/2 pointer-events-auto absolute right-0 flex h-3.5 w-full cursor-pointer items-center justify-end focus-visible:outline focus-visible:outline-(--accent-9)"
                    style={{
                      top: `${(index / (messages.length - 1)) * 100}%`,
                    }}
                  >
                    <span
                      className={cn(
                        "h-[3px] rounded-full transition-[width,background-color] duration-150",
                        isActive
                          ? "w-4 bg-(--accent-9)"
                          : "w-2.5 bg-(--gray-a6) group-hover:w-4 group-hover:bg-(--gray-a9)",
                      )}
                    />
                  </button>
                }
              />
              <TooltipContent side="left" className="max-w-72">
                {message.preview}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
