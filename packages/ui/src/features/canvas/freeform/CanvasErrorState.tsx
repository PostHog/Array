import { WarningIcon } from "@phosphor-icons/react";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";

// Shown when a canvas has nothing on screen because it failed to load or render:
// a CDN/runtime fetch that never landed, a compile error, or a render throw the
// sandbox's boundary swallowed. Without it the viewport is simply blank — and in
// view mode (no toolbar) that blank carries no explanation and no way out.
// Recoverable: "Try again" rebuilds the frame, and in edit mode the agent can be
// pointed straight at the error.
export function CanvasErrorState({
  message,
  onRetry,
  onAskAgent,
}: {
  message: string;
  onRetry: () => void;
  /** Edit mode only — omitted in view mode, where there's no composer. */
  onAskAgent?: () => void;
}) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningIcon size={24} />
        </EmptyMedia>
        <EmptyTitle>Couldn't load this canvas</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="primary" size="default" onClick={onRetry}>
          Try again
        </Button>
        {onAskAgent && (
          <Button variant="outline" size="default" onClick={onAskAgent}>
            Ask agent to fix
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}
