import { UserRound } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  EmbedCard,
  EmbedCardError,
  EmbedCardHint,
  EmbedCardRow,
  EmbedCardSkeleton,
} from "./EmbedCard";
import { formatDateTime, getIdProp } from "./embedProps";
import { buildPostHogEntityUrl } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

const KEY_PROPERTIES: { key: string; label: string }[] = [
  { key: "$geoip_country_name", label: "Country" },
  { key: "$browser", label: "Browser" },
  { key: "$os", label: "OS" },
];

export function PersonEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const uuid = getIdProp(node.props.id);
  const distinctId = getIdProp(node.props.distinctId);
  const hasLookup = uuid !== null || distinctId !== null;
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["person", uuid, distinctId],
    (client) =>
      client.getPerson({
        uuid: uuid ?? undefined,
        distinctId: distinctId ?? undefined,
      }),
    { enabled: hasLookup },
  );

  if (!hasLookup) {
    return (
      <EmbedCard icon={<UserRound />} title="Person">
        <EmbedCardHint>No person configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return (
      <EmbedCardError
        title={`Person ${uuid ?? distinctId ?? ""}`}
        error={error}
      />
    );
  }

  const firstDistinctId = data.distinct_ids?.[0] ?? null;
  const displayName = data.name ?? firstDistinctId ?? uuid ?? "Person";
  const linkId = firstDistinctId ?? uuid ?? distinctId;
  const url =
    appHost && teamId != null && linkId
      ? buildPostHogEntityUrl(appHost, teamId, { kind: "person", id: linkId })
      : null;
  const firstSeen = formatDateTime(data.created_at);
  const properties = data.properties ?? {};

  return (
    <EmbedCard icon={<UserRound />} title={displayName} url={url}>
      {firstSeen ? (
        <EmbedCardRow label="First seen">{firstSeen}</EmbedCardRow>
      ) : null}
      {KEY_PROPERTIES.map(({ key, label }) => {
        const value = properties[key];
        return value != null && value !== "" ? (
          <EmbedCardRow key={key} label={label}>
            {String(value)}
          </EmbedCardRow>
        ) : null;
      })}
    </EmbedCard>
  );
}
