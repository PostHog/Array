import { MessageCircleQuestion } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  EmbedCard,
  EmbedCardError,
  EmbedCardHint,
  EmbedCardRow,
  EmbedCardSkeleton,
} from "./EmbedCard";
import { deriveRunStatus, getIdProp } from "./embedProps";
import { buildPostHogEntityUrl } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

export function SurveyEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const id = getIdProp(node.props.id);
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["survey", id],
    (client) => client.getSurvey(id ?? ""),
    { enabled: id !== null },
  );

  if (!id) {
    return (
      <EmbedCard icon={<MessageCircleQuestion />} title="Survey">
        <EmbedCardHint>No survey configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return <EmbedCardError title={`Survey ${id}`} error={error} />;
  }

  const status = deriveRunStatus(data.start_date, data.end_date);
  const questionCount = Array.isArray(data.questions)
    ? data.questions.length
    : null;
  const url =
    appHost && teamId != null
      ? buildPostHogEntityUrl(appHost, teamId, {
          kind: "survey",
          id: String(data.id),
        })
      : null;

  return (
    <EmbedCard
      icon={<MessageCircleQuestion />}
      title={data.name}
      badge={status.label}
      badgeVariant={status.variant}
      url={url}
    >
      {data.description ? (
        <EmbedCardRow label="Description">{data.description}</EmbedCardRow>
      ) : null}
      {questionCount != null ? (
        <EmbedCardRow label="Questions">{questionCount}</EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
