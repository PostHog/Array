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
import { formatDateTime, getIdProp, getNumberProp } from "./embedProps";
import { useEmbedQuery } from "./useEmbedQuery";

export function GroupEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  // Current props are `{id, groupTypeIndex}`; the legacy placeholder shape was
  // `{type, key}` — map `key` to the group key when `id` is absent.
  const groupKey = getIdProp(node.props.id) ?? getIdProp(node.props.key);
  const groupTypeIndex =
    getNumberProp(node.props.groupTypeIndex) ?? getNumberProp(node.props.type);
  const hasLookup = groupKey !== null && groupTypeIndex !== null;
  const { data, isLoading, error } = useEmbedQuery(
    ["group", groupTypeIndex, groupKey],
    (client) => client.getGroup(groupTypeIndex ?? 0, groupKey ?? ""),
    { enabled: hasLookup },
  );

  if (!hasLookup) {
    return (
      <EmbedCard icon={<Users />} title="Group">
        <EmbedCardHint>No group configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return <EmbedCardError title={`Group ${groupKey}`} error={error} />;
  }

  const createdAt = formatDateTime(data.created_at);

  return (
    <EmbedCard icon={<Users />} title={data.group_key}>
      {createdAt ? (
        <EmbedCardRow label="First seen">{createdAt}</EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
