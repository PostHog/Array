import type { TaskIconSpec } from "@posthog/ui/features/design-system/taskIconSpecs";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import {
  TaskBadgeStack,
  TaskStatusDot,
  TaskStatusTooltips,
} from "@posthog/ui/features/sidebar/components/items/TaskStatusDot";
import { taskDot } from "@posthog/ui/features/sidebar/components/items/taskStatusVocabulary";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";

const TIMESTAMP_CLASS = "shrink-0 text-[11px] text-muted-foreground";

/** What ships today: the cascade's single glyph, with a timestamp trailing. */
export function CurrentTaskRow({ spec }: { spec: TaskIconSpec }) {
  return (
    <SidebarItem
      depth={0}
      icon={<TaskIcon {...spec.props} />}
      label={spec.vocab}
      endContent={<span className={TIMESTAMP_CLASS}>{spec.age}</span>}
    />
  );
}

/**
 * The proposal, built from the same components the space task list uses — so
 * this page previews the real thing rather than a mock of it. Both columns use
 * the real `SidebarItem`, so hovering a row tickers the label as it does in the
 * app.
 */
export function CustomTaskRow({ spec }: { spec: TaskIconSpec }) {
  return (
    <TaskStatusTooltips>
      <SidebarItem
        depth={0}
        icon={<TaskStatusDot dot={taskDot(spec.props)} />}
        label={spec.vocab}
        endContent={<TaskBadgeStack status={spec.props} />}
      />
    </TaskStatusTooltips>
  );
}
