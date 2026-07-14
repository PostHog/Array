import { Video } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  EmbedCard,
  EmbedCardError,
  EmbedCardHint,
  EmbedCardRow,
  EmbedCardSkeleton,
} from "./EmbedCard";
import {
  formatDateTime,
  formatDuration,
  getIdProp,
  getNumberProp,
} from "./embedProps";
import { buildPostHogEntityUrl } from "./openInPostHog";
import { useEmbedQuery } from "./useEmbedQuery";

export function RecordingEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const id = getIdProp(node.props.id);
  const timestampMs = getNumberProp(node.props.timestampMs);
  const { data, teamId, appHost, isLoading, error } = useEmbedQuery(
    ["session-recording", id],
    (client) => client.getSessionRecordingMeta(id ?? ""),
    { enabled: id !== null },
  );

  if (!id) {
    return (
      <EmbedCard icon={<Video />} title="Session recording">
        <EmbedCardHint>No recording configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (isLoading) return <EmbedCardSkeleton />;
  if (error || !data) {
    return <EmbedCardError title={`Recording ${id}`} error={error} />;
  }

  const personDisplay =
    data.person?.name ?? data.person?.distinct_ids?.[0] ?? null;
  const startedAt = formatDateTime(data.start_time);
  const duration = formatDuration(data.recording_duration);
  const url =
    appHost && teamId != null
      ? buildPostHogEntityUrl(appHost, teamId, {
          kind: "replay",
          id: data.id,
          timestampSeconds:
            timestampMs != null ? timestampMs / 1000 : undefined,
        })
      : null;

  return (
    <EmbedCard
      icon={<Video />}
      title={personDisplay ?? `Recording ${data.id}`}
      badge={duration}
      url={url}
    >
      {startedAt ? (
        <EmbedCardRow label="Started">{startedAt}</EmbedCardRow>
      ) : null}
      {data.click_count != null || data.keypress_count != null ? (
        <EmbedCardRow label="Activity">
          {[
            data.click_count != null ? `${data.click_count} clicks` : null,
            data.keypress_count != null
              ? `${data.keypress_count} keypresses`
              : null,
            data.console_error_count
              ? `${data.console_error_count} console errors`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </EmbedCardRow>
      ) : null}
    </EmbedCard>
  );
}
