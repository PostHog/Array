import { Database } from "lucide-react";
import type { JSX } from "react";
import { PythonCellEmbed } from "./cells/PythonCellEmbed";
import { DuckSqlCellEmbed, HogqlSqlCellEmbed } from "./cells/SqlCellEmbed";
import { SqlV2CellEmbed } from "./cells/SqlV2CellEmbed";
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
      exclusiveEditPanel: true,
      hideModeActions: true,
      getTitle: (node) =>
        isDiscussionCommentProps(node.props)
          ? (getNotebookDiscussionCommentTitle(node) ?? "Comment")
          : (baseComment.getTitle?.(node) ?? "Comment"),
    };
  }
  // Runnable cells embed their own code editor and run controls, so they
  // render through the same component in both modes — the generic JSON props
  // edit panel must never appear for them. The vendored default registry has
  // no insertCommand for these tags (render-only upstream; the webapp's
  // insert entries live in its own registry), and the InsertMenu skips
  // definitions without one — so an empty insertCommand is added to surface
  // them in the slash menu with the definition's own label/category/icon.
  for (const [tagName, CellComponent] of Object.entries(CELL_OVERRIDES)) {
    const baseDefinition = base.components[tagName];
    components[tagName] = {
      ...(baseDefinition ?? CELL_FALLBACK_DEFINITIONS[tagName]),
      insertCommand: baseDefinition?.insertCommand ?? {},
      ViewComponent: CellComponent,
      EditComponent: CellComponent,
      // One component serves both shell slots; without exclusiveEditPanel the
      // shell renders the edit AND view panels at once — two identical code
      // editors (mirrors upstream's same-component overrides).
      exclusiveEditPanel: true,
      hideModeActions: true,
    };
  }
  return mergeMarkdownNotebookRegistries(base, { components });
}

const CELL_OVERRIDES: Record<
  string,
  (props: NotebookComponentRenderProps) => JSX.Element
> = {
  Python: PythonCellEmbed,
  HogQLSQL: HogqlSqlCellEmbed,
  DuckSQL: DuckSqlCellEmbed,
  SQLV2: SqlV2CellEmbed,
};

// Insert metadata for cell tags missing from the vendored default registry
// (today only SQLV2; Python/HogQLSQL/DuckSQL exist there and keep their base
// label/category/icon/defaultProps).
const CELL_FALLBACK_DEFINITIONS: Record<
  string,
  Omit<NotebookComponentDefinition, "ViewComponent" | "EditComponent">
> = {
  Python: {
    tagName: "Python",
    label: "Python",
    category: "Code",
    description: "Runnable Python cell",
    icon: <Database />,
    defaultProps: { code: "", title: "Python" },
  },
  HogQLSQL: {
    tagName: "HogQLSQL",
    label: "SQL (HogQL)",
    category: "Code",
    description: "Runnable HogQL cell",
    icon: <Database />,
    defaultProps: { code: "", returnVariable: "hogql_df" },
  },
  DuckSQL: {
    tagName: "DuckSQL",
    label: "SQL (DuckDB)",
    category: "Code",
    description: "Runnable DuckDB cell",
    icon: <Database />,
    defaultProps: { code: "", returnVariable: "duck_df" },
  },
  SQLV2: {
    tagName: "SQLV2",
    label: "SQL (v2)",
    category: "Code",
    description: "Async SQL run with pageable results",
    icon: <Database />,
    defaultProps: { code: "", returnVariable: "sql_df" },
  },
};
