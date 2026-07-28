import { cn, Text } from "@posthog/quill";
import { FreeformCanvas } from "@posthog/ui/features/canvas/freeform/FreeformCanvas";
import { handleFreeformDataRequest } from "@posthog/ui/features/canvas/freeform/freeformDataBridge";
import { useInView } from "@posthog/ui/primitives/hooks/useInView";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { Box, Flex } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// Render each canvas's live app at 1/SCALE of the card width, then shrink so it
// fits inside the preview frame as a thumbnail.
const PREVIEW_SCALE = 0.4;

// Mount a preview only while it's near the viewport, and UNMOUNT it once it
// scrolls away (once: false). This caps how many full preview trees / sandbox
// iframes are live at any time, so a channel with many large canvases doesn't
// accumulate pages of off-screen DOM. The margin pre-mounts a little early so
// scrolling doesn't flash an empty frame. The fixed-height frame keeps the
// layout stable across mount/unmount (no scroll jump).
const PREVIEW_VIEWPORT = { once: false, rootMargin: "400px 0px" } as const;

// A freeform (React-in-iframe) canvas preview: the app rendered at PREVIEW_SCALE
// in a clipped frame. Deferred until near the viewport, and runs with NO
// analytics so it fires no events.
export function FreeformPreview({
  code,
  height = 176,
  className,
}: {
  code?: string;
  /** Frame height in px. Taller frames simply reveal more of the app. */
  height?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>(PREVIEW_VIEWPORT);

  // Preview data handler: swallow captures so a thumbnail never emits analytics
  // events, but let reads through (cached, shared with the full view) so the
  // preview shows real-ish content. (posthog-js itself is never booted — no
  // `analytics` prop — so there's no autocapture/pageview/replay either.)
  const queryClient = useQueryClient();
  const onDataRequest = useCallback(
    (method: string, payload: unknown) =>
      method === "capture"
        ? Promise.resolve({ ok: true })
        : handleFreeformDataRequest(method, payload, queryClient),
    [queryClient],
  );

  return (
    <Box
      ref={ref}
      className={cn("relative overflow-hidden bg-muted", className)}
      style={{ height }}
    >
      {code ? (
        inView ? (
          <Box
            className="pointer-events-none absolute top-0 left-0 origin-top-left"
            style={{
              transform: `scale(${PREVIEW_SCALE})`,
              width: `${100 / PREVIEW_SCALE}%`,
              // The scaled iframe fills exactly the frame it shrinks into, so a
              // taller frame shows more of the app rather than more empty space.
              height: height / PREVIEW_SCALE,
            }}
          >
            <ErrorBoundary
              name="freeform-preview"
              resetKey={code}
              fallback={<PreviewPlaceholder label="Preview unavailable" />}
            >
              <FreeformCanvas
                code={code}
                mode="edit"
                onDataRequest={onDataRequest}
              />
            </ErrorBoundary>
          </Box>
        ) : (
          <PreviewPlaceholder label="Loading preview…" />
        )
      ) : (
        <PreviewPlaceholder label="Empty canvas" />
      )}
    </Box>
  );
}

function PreviewPlaceholder({ label }: { label: string }) {
  return (
    <Flex
      align="center"
      justify="center"
      className="absolute inset-0 text-center"
    >
      <Text size="xs" variant="muted">
        {label}
      </Text>
    </Flex>
  );
}
