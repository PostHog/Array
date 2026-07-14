import { Rocket } from "lucide-react";
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
import { buildPostHogEntityUrl, openInPostHog } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

export function EarlyAccessFeatureEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const id = getIdProp(node.props.id);
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["early-access-feature", id],
    (client) => client.getEarlyAccessFeature(id ?? ""),
    { enabled: id !== null },
  );

  if (!id) {
    return (
      <EmbedCard icon={<Rocket />} title="Early access feature">
        <EmbedCardHint>No early access feature configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return (
      <EmbedCardError title={`Early access feature ${id}`} error={error} />
    );
  }

  const url =
    appHost && teamId != null
      ? buildPostHogEntityUrl(appHost, teamId, {
          kind: "earlyAccessFeature",
          id: String(data.id),
        })
      : null;

  return (
    <EmbedCard
      icon={<Rocket />}
      title={data.name}
      badge={data.stage ?? null}
      badgeVariant="info"
      url={url}
    >
      {data.description ? (
        <EmbedCardRow label="Description">{data.description}</EmbedCardRow>
      ) : null}
      {data.documentation_url ? (
        <EmbedCardRow label="Docs">
          <button
            type="button"
            className="cursor-pointer truncate text-(--accent-11) underline"
            onClick={() => {
              if (data.documentation_url) openInPostHog(data.documentation_url);
            }}
          >
            {data.documentation_url}
          </button>
        </EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
