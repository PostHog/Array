import { Globe } from "lucide-react";
import type { JSX } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import { EmbedCard, EmbedCardHint } from "./EmbedCard";
import { getNumberProp, getStringProp } from "./embedProps";

const DEFAULT_HEIGHT = 400;

export function EmbedFrame({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const src = getStringProp(node.props.src);
  const title = getStringProp(node.props.title) ?? "Embedded content";
  const height = getNumberProp(node.props.height) ?? DEFAULT_HEIGHT;

  if (!src) {
    return (
      <EmbedCard icon={<Globe />} title="Embed">
        <EmbedCardHint>No embed URL configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (!src.startsWith("http://") && !src.startsWith("https://")) {
    return (
      <EmbedCard icon={<Globe />} title="Embed">
        <EmbedCardHint>Only http(s) URLs can be embedded: {src}</EmbedCardHint>
      </EmbedCard>
    );
  }

  return (
    <iframe
      className="w-full rounded-md border border-(--gray-4)"
      src={src}
      title={title}
      sandbox="allow-scripts allow-same-origin"
      style={{ height: `${height}px` }}
    />
  );
}
