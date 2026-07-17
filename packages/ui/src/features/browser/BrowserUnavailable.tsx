import { Globe } from "@phosphor-icons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";

export function BrowserUnavailable() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Globe size={28} />
        </EmptyMedia>
        <EmptyTitle>Browser unavailable</EmptyTitle>
        <EmptyDescription>
          This host does not support embedded browser tabs.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
