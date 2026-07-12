import {
  BugIcon,
  BuildingsIcon,
  ChartLineIcon,
  ClipboardTextIcon,
  FlagIcon,
  FlaskIcon,
  LightningIcon,
  NotebookIcon,
  RocketLaunchIcon,
  SquaresFourIcon,
  UserIcon,
  UsersThreeIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import type { PostHogResourceType } from "@posthog/core/message-editor/posthogUrl";
import { Chip } from "@posthog/quill";
import type { ComponentType, ReactNode } from "react";

const resourceIconMap: Record<
  PostHogResourceType,
  ComponentType<{ size: number }>
> = {
  feature_flag: FlagIcon,
  experiment: FlaskIcon,
  insight: ChartLineIcon,
  dashboard: SquaresFourIcon,
  error_tracking: BugIcon,
  recording: VideoIcon,
  survey: ClipboardTextIcon,
  notebook: NotebookIcon,
  cohort: UsersThreeIcon,
  action: LightningIcon,
  early_access_feature: RocketLaunchIcon,
  person: UserIcon,
  group: BuildingsIcon,
};

export function PostHogRefChip({
  href,
  resourceType,
  children,
}: {
  href: string;
  resourceType: PostHogResourceType;
  children: ReactNode;
}) {
  const Icon = resourceIconMap[resourceType];
  return (
    <Chip
      size="xs"
      onClick={() => window.open(href, "_blank")}
      className="cli-file-mention mx-0.5 max-w-full cursor-pointer! whitespace-nowrap pl-1 align-middle active:translate-y-0"
    >
      <Icon size={10} />
      <span className="min-w-0 truncate">{children}</span>
    </Chip>
  );
}
