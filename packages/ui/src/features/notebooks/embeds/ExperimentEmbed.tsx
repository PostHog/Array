import { FlaskConical } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  EmbedCard,
  EmbedCardError,
  EmbedCardHint,
  EmbedCardRow,
  EmbedCardSkeleton,
} from "./EmbedCard";
import { deriveRunStatus, formatDate, getNumberProp } from "./embedProps";
import { buildPostHogEntityUrl } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

function countVariants(parameters: unknown): number | null {
  if (!parameters || typeof parameters !== "object") return null;
  const variants = (parameters as { feature_flag_variants?: unknown })
    .feature_flag_variants;
  return Array.isArray(variants) ? variants.length : null;
}

export function ExperimentEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const id = getNumberProp(node.props.id);
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["experiment", id],
    (client) => client.getExperiment(id ?? 0),
    { enabled: id !== null },
  );

  if (id === null) {
    return (
      <EmbedCard icon={<FlaskConical />} title="Experiment">
        <EmbedCardHint>No experiment configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return <EmbedCardError title={`Experiment ${id}`} error={error} />;
  }

  const status = deriveRunStatus(data.start_date, data.end_date);
  const variantCount = countVariants(data.parameters);
  const metricsCount = Array.isArray(data.metrics) ? data.metrics.length : null;
  const startedAt = formatDate(data.start_date);
  const endedAt = formatDate(data.end_date);
  const url =
    appHost && teamId != null
      ? buildPostHogEntityUrl(appHost, teamId, {
          kind: "experiment",
          id: String(data.id),
        })
      : null;

  return (
    <EmbedCard
      icon={<FlaskConical />}
      title={data.name}
      badge={status.label}
      badgeVariant={status.variant}
      url={url}
    >
      {data.description ? (
        <EmbedCardRow label="Description">{data.description}</EmbedCardRow>
      ) : null}
      {startedAt ? (
        <EmbedCardRow label="Duration">
          {startedAt} → {endedAt ?? "now"}
        </EmbedCardRow>
      ) : null}
      {variantCount != null ? (
        <EmbedCardRow label="Variants">{variantCount}</EmbedCardRow>
      ) : null}
      {metricsCount != null ? (
        <EmbedCardRow label="Metrics">{metricsCount}</EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
