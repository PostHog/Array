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
              topPct: 0.23,
              label: "Add a marker to the scrollbar for my messages",
            }),
            marker({
              id: "m3",
              topPct: 0.48,
              label: "Why did the build break on CI?",
              active: true,
            }),
            marker({
              id: "m4",
              topPct: 0.71,
              label: "Can you color the scrollbar based on conversation data?",
            }),
            marker({
              id: "m5",
              topPct: 0.93,
              label: "Ship it",
            }),
          ]}
        />
        {/* Caption so the rail (8px, far right) isn't the only thing on screen. */}
        <div className="flex h-full items-center justify-center px-12 text-center">
          <p className="text-(--gray-10) text-[13px] leading-relaxed">
            Markers sit in the scrollbar gutter on the right. Hover one to see
            the first few words; click to jump. The accent-colored marker is
            active.
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
  reply: string;
}

function buildTranscript(): TranscriptEntry[] {
  const prompts = [
    "How do I set up the dev environment for this repo?",
    "Add a darker marker to the scrollbar where my messages are",
    "Why did the build break after the last merge?",
    "Can you color the scrollbar based on data in the conversation?",
    "Show the first few words of each message as a tooltip",
    "Walk me through the DI boot sequence",
    "What does the host boundary check enforce?",
    "Refactor the conversation items pipeline",
    "Generate a changelog entry for the rail",
    "Ship it once tests are green",
  ];
  return prompts.map((prompt, i) => ({
    id: `user-${i}`,
    prompt,
    reply: `Here's a thorough answer to "${prompt}". `.repeat(40),
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
      <div className="relative flex-1">
        {/* The scroll viewport. `scrollbar-gutter: stable` reserves the gutter the
            rail sits over, matching the real ConversationView. */}
        <div
          ref={scrollRef}
          className="scroll-mask-8 h-full overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          <div ref={contentRef} className="relative">
            {transcript.map((entry) => (
              <div
                key={entry.id}
                data-conversation-item-id={entry.id}
                className="mx-auto max-w-[640px] px-4 py-3"
              >
                <div
                  className="rounded-(--radius-2) px-3 py-2 text-[13px] text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  {entry.prompt}
                </div>
                <p className="mt-2 text-(--gray-11) text-[13px] leading-relaxed">
                  {entry.reply}
                </p>
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
