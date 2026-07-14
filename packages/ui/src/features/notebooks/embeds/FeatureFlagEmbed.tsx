import { Flag } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  EmbedCard,
  EmbedCardError,
  EmbedCardHint,
  EmbedCardRow,
  EmbedCardSkeleton,
} from "./EmbedCard";
import { getIdProp } from "./embedProps";
import { buildPostHogEntityUrl } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

export function FeatureFlagEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const id = getIdProp(node.props.id);
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["feature-flag", id],
    (client) => client.getFeatureFlag(id ?? ""),
    { enabled: id !== null },
  );

  if (!id) {
    return (
      <EmbedCard icon={<Flag />} title="Feature flag">
        <EmbedCardHint>No feature flag configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return <EmbedCardError title={`Feature flag ${id}`} error={error} />;
  }

  const url =
    appHost && teamId != null
      ? buildPostHogEntityUrl(appHost, teamId, {
          kind: "featureFlag",
          id: String(data.id),
        })
      : null;

  return (
    <EmbedCard
      icon={<Flag />}
      title={data.key}
      badge={data.active ? "Enabled" : "Disabled"}
      badgeVariant={data.active ? "success" : "default"}
      url={url}
    >
      {data.name ? (
        <EmbedCardRow label="Description">{data.name}</EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
