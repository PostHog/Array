import { BugIcon } from "@phosphor-icons/react";
import { TaskNavColumn } from "@posthog/ui/features/design-system/TaskNavColumn";
import {
  CurrentTaskRow,
  CustomTaskRow,
} from "@posthog/ui/features/design-system/taskRows";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import {
  PageHeader,
  PageHeaderChip,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
  PageHeaderTitleRow,
} from "@posthog/ui/primitives/PageHeader";

/**
 * Debug page for the task row treatments the sidebar and spaces draw. Both
 * columns are real nav lists over the same dummy tasks — no queries, no live
 * state — so every state is on screen at once instead of whichever ones the
 * current workspace happens to have. Each row is labelled with the vocabulary
 * for its state, so the columns are self-documenting.
 */
export function DesignSystemView() {
  // A root-level debug page has no space to walk back to, so it contributes no
  // breadcrumb (matching the command centre).
  useSetHeaderContent(null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitleRow>
            <PageHeaderTitle>Design system</PageHeaderTitle>
            <PageHeaderChip icon={<BugIcon size={12} />}>Debug</PageHeaderChip>
          </PageHeaderTitleRow>
          <PageHeaderDescription>
            Task rows in every state the status cascade can reach, labelled with
            what that state means. Hover a row to ticker the label, or its dot
            and badges for the shorthand.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <div className="flex min-h-0 flex-1 gap-4 p-6">
        <TaskNavColumn
          title="Current"
          subtitle="One glyph, chosen by priority — the highest state wins and the rest are invisible."
          renderRow={(spec) => <CurrentTaskRow spec={spec} />}
        />
        <TaskNavColumn
          title="Custom"
          subtitle="Dot only for attention — blue wants a decision, amber is working or unread, hollow grey means nothing owed. Run mechanics never reach the list; badges carry identity, and PR state carries its own colour."
          renderRow={(spec) => <CustomTaskRow spec={spec} />}
        />
      </div>
    </div>
  );
}
