import type { JSX } from "react";
import { CohortEmbed } from "./embeds/CohortEmbed";
import {
  DiscussionCommentEmbed,
  getNotebookDiscussionCommentTitle,
} from "./embeds/DiscussionCommentEmbed";
import { EarlyAccessFeatureEmbed } from "./embeds/EarlyAccessFeatureEmbed";
import { EmbedFrame } from "./embeds/EmbedFrame";
import { ExperimentEmbed } from "./embeds/ExperimentEmbed";
import { FeatureFlagEmbed } from "./embeds/FeatureFlagEmbed";
import { GroupEmbed } from "./embeds/GroupEmbed";
import { ImageEmbed } from "./embeds/ImageEmbed";
import { PersonEmbed } from "./embeds/PersonEmbed";
import { QueryEmbed } from "./embeds/QueryEmbed";
import { RecordingEmbed } from "./embeds/RecordingEmbed";
import { SurveyEmbed } from "./embeds/SurveyEmbed";
import { isDiscussionCommentProps } from "./markdown-notebook/markdown";
import {
  getMarkdownNotebookDefaultRegistry,
  mergeMarkdownNotebookRegistries,
} from "./markdown-notebook/registry";
import type {
  NotebookComponentDefinition,
  NotebookComponentRegistry,
  NotebookComponentRenderProps,
} from "./markdown-notebook/types";

// The default (vendored) registry renders PostHog entity blocks as JSON
// previews. This registry swaps in live views backed by the real PostHog
// API — the desktop replacement for the webapp's notebook-node runtime.
// Base definitions are spread so the insert-command metadata (label,
// category, icon, defaultProps) and the generic props edit panel survive.
const VIEW_OVERRIDES: Record<
  string,
  (props: NotebookComponentRenderProps) => JSX.Element
> = {
  Query: QueryEmbed,
  FeatureFlag: FeatureFlagEmbed,
  Experiment: ExperimentEmbed,
  Survey: SurveyEmbed,
  EarlyAccessFeature: EarlyAccessFeatureEmbed,
  Cohort: CohortEmbed,
  Person: PersonEmbed,
  Group: GroupEmbed,
  Recording: RecordingEmbed,
  Image: ImageEmbed,
  Embed: EmbedFrame,
};

export function getNotebooksAppRegistry(): NotebookComponentRegistry {
  const base = getMarkdownNotebookDefaultRegistry();
  // All overridden tags exist in the default registry today; if one ever goes
  // missing, fall back to a minimal definition reusing Query's edit panel.
  const fallbackEditComponent = base.components.Query?.EditComponent;
  const components: Record<string, NotebookComponentDefinition> = {};
  for (const [tagName, ViewComponent] of Object.entries(VIEW_OVERRIDES)) {
    const baseDefinition = base.components[tagName];
    components[tagName] = baseDefinition
      ? { ...baseDefinition, ViewComponent }
      : {
          tagName,
          label: tagName.replace(/([a-z])([A-Z])/g, "$1 $2"),
          category: "PostHog",
          defaultProps: {},
          ViewComponent,
          EditComponent: fallbackEditComponent,
        };
  }
  // Discussion-flavor `<Comment ref replies>` threads render (and reply)
  // through the same component in both modes — the generic props edit panel
  // makes no sense for a comment thread. Authorial `<!-- -->` comments render
  // via CommentBlock before the registry is consulted, so this only affects
  // threads (mirrors the webapp's registry override).
  const baseComment = base.components.Comment;
  if (baseComment) {
    components.Comment = {
      ...baseComment,
      ViewComponent: DiscussionCommentEmbed,
      EditComponent: DiscussionCommentEmbed,
      getTitle: (node) =>
        isDiscussionCommentProps(node.props)
          ? (getNotebookDiscussionCommentTitle(node) ?? "Comment")
          : (baseComment.getTitle?.(node) ?? "Comment"),
    };
  }
  return mergeMarkdownNotebookRegistries(base, { components });
}
