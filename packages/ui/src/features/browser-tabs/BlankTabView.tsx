import { SquareIcon } from "@phosphor-icons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";

/** Placeholder shown when the active browser tab has no canvas yet. */
export function BlankTabView() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SquareIcon size={28} />
        </EmptyMedia>
        <EmptyTitle>New tab</EmptyTitle>
        <EmptyDescription>
          Pick a canvas from the sidebar to open it here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
