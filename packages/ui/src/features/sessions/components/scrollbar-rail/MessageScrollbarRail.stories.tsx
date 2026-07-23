import { MessageScrollbarRail } from "@posthog/ui/features/sessions/components/scrollbar-rail/MessageScrollbarRail";
import type { MessageRailMarker } from "@posthog/ui/features/sessions/components/scrollbar-rail/messageRailTypes";
import { useMessageRailMarkers } from "@posthog/ui/features/sessions/components/scrollbar-rail/useMessageRailMarkers";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useRef, useState } from "react";

/**
 * Stories for the conversation scrollbar marker rail.
 *
 * `Pure` is the rail in isolation with a hand-built marker set (no scroll wiring)
 * — useful for eyeballing marker sizing / spacing / active state.
 *
 * `ScrollableConversation` is the real experience: a synthetic transcript that
 * scrolls, wired through `useMessageRailMarkers`, so you can scroll, click a
 * marker to jump to its message, and hover one to see its first few words.
 */
const meta: Meta<typeof MessageScrollbarRail> = {
  title: "Features/Sessions/ScrollbarRail",
  component: MessageScrollbarRail,
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;
type Story = StoryObj<typeof MessageScrollbarRail>;

const ACCENT = "var(--accent-9)";

function marker(overrides: Partial<MessageRailMarker>): MessageRailMarker {
  return {
    id: overrides.id ?? "m1",
    topPct: overrides.topPct ?? 0,
    heightPct: overrides.heightPct ?? 0.04,
    label: overrides.label ?? "first few words",
    active: overrides.active,
    onClick: overrides.onClick ?? (() => {}),
  };
}

export const Pure: Story = {
  render: () => (
    <div className="flex h-[90vh] items-center justify-center bg-(--gray-1)">
      {/* A fixed-height box so the rail's `h-full` has something to fill. */}
      <div className="relative h-[520px] w-[440px] rounded-(--radius-3) border border-(--gray-4) bg-(--gray-2)">
        <MessageScrollbarRail
          markers={[
            marker({
              id: "m1",
              topPct: 0,
              label: "How do I set up the dev env?",
            }),
            marker({
              id: "m2",
              topPct: 0.52,
              label: "Add a marker to the scrollbar for my messages",
              active: true,
            }),
          ]}
        />
        {/* Caption so the rail (8px, far right) isn't the only thing on screen. */}
        <div className="flex h-full items-center justify-center px-12 text-center">
          <p className="text-(--gray-10) text-[13px] leading-relaxed">
            Each human message has one marker in the scrollbar gutter. Hover a
            marker to preview the message; click to jump. The accent-colored
            marker is active.
          </p>
        </div>
      </div>
    </div>
  ),
};

/** A synthetic transcript used by the scrollable story. Each entry is one user
 * message followed by a tall agent reply, so there's something to scroll. */
interface TranscriptEntry {
  id: string;
  prompt: string;
  reply: string[];
}

function buildTranscript(): TranscriptEntry[] {
  const prompts = [
    "How do I set up the dev environment for this repo?",
    "Add a darker marker to the scrollbar where my messages are",
  ];
  return prompts.map((prompt, i) => ({
    id: `user-${i}`,
    prompt,
    reply: Array.from(
      { length: 10 },
      (_, paragraph) =>
        `Response paragraph ${paragraph + 1}. Here's a thorough answer to "${prompt}" with enough detail to make the conversation scroll naturally.`,
    ),
  }));
}

/** Callback-ref helper: forwards the element to a state setter once attached. */
function useRefState<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [el, ref] as const;
}

/** The scrollable transcript: a tall content element with `data-conversation-item-id`
 * rows, plus the rail wired through `useMessageRailMarkers`. Mirrors how the real
 * `ConversationView` mounts the rail (the content element is the measured offset
 * parent; the scroll element is the `overflow-y-auto` viewport). */
function ScrollableConversationDemo() {
  const transcript = useRef(buildTranscript()).current;
  const [activeId, setActiveId] = useState<string | null>(null);

  const [scrollEl, scrollRef] = useRefState<HTMLDivElement>();
  const [contentEl, contentRef] = useRefState<HTMLDivElement>();

  const userMessages = useRef(
    transcript.map((entry, index) => ({
      id: entry.id,
      content: entry.prompt,
      index,
    })),
  ).current;

  const onJump = useCallback(
    (id: string) => {
      setActiveId(id);
      const row = contentEl?.querySelector(
        `[data-conversation-item-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      row?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [contentEl],
  );

  const markers = useMessageRailMarkers({
    contentEl,
    scrollEl,
    userMessages,
    onJump,
    activeId,
  });

  return (
    <div className="flex h-[90vh] flex-col bg-background">
      <div className="border-(--gray-4) border-b px-4 py-2">
        <span className="text-(--gray-11) text-[13px]">
          Scroll the transcript, then click a marker in the scrollbar to jump to
          that message, or hover one for a preview.
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Pin the scroll viewport to this bounded flex child, matching the real
            ConversationView. Keeping the viewport out of normal flow prevents
            the long mock transcript from making the rail content-height and
            spreading most markers below the captured scene. `scrollbar-gutter:
            stable` reserves the gutter the rail sits over. */}
        <div
          ref={scrollRef}
          className="scroll-mask-8 absolute inset-0 overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          <div ref={contentRef} className="relative">
            {transcript.map((entry) => (
              <div key={entry.id} className="mx-auto max-w-[640px] px-4 py-3">
                <div
                  data-conversation-item-id={entry.id}
                  className="rounded-(--radius-2) px-3 py-2 text-[13px] text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  {entry.prompt}
                </div>
                <div className="mt-2 space-y-3 text-(--gray-11) text-[13px] leading-relaxed">
                  {entry.reply.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <MessageScrollbarRail markers={markers} />
      </div>
    </div>
  );
}

export const ScrollableConversation: Story = {
  render: () => <ScrollableConversationDemo />,
};
