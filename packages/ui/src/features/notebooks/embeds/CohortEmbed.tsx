import { Users } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  EmbedCard,
  EmbedCardError,
  EmbedCardHint,
  EmbedCardRow,
  EmbedCardSkeleton,
} from "./EmbedCard";
import { getNumberProp } from "./embedProps";
import { buildPostHogEntityUrl } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

export function CohortEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const id = getNumberProp(node.props.id);
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["cohort", id],
    (client) => client.getCohort(id ?? 0),
    { enabled: id !== null },
  );

  if (id === null) {
    return (
      <EmbedCard icon={<Users />} title="Cohort">
        <EmbedCardHint>No cohort configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return <EmbedCardError title={`Cohort ${id}`} error={error} />;
  }

  const url =
    appHost && teamId != null
      ? buildPostHogEntityUrl(appHost, teamId, {
          kind: "cohort",
          id: String(data.id),
        })
      : null;

  return (
    <EmbedCard
      icon={<Users />}
      title={data.name}
      badge={data.is_static ? "Static" : "Dynamic"}
      badgeVariant={data.is_static ? "default" : "info"}
      url={url}
    >
      {data.count != null ? (
        <EmbedCardRow label="People">
          {data.count.toLocaleString()}
        </EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
