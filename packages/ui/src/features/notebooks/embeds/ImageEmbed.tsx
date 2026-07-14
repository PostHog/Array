import { Image as ImageIcon } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import { EmbedCard, EmbedCardError, EmbedCardHint } from "./EmbedCard";
import { getStringProp } from "./embedProps";
import { useEmbedQuery } from "./useEmbedQuery";

export function ImageEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const src = getStringProp(node.props.src);
  const alt = getStringProp(node.props.alt) ?? "Notebook image";

  if (!src) {
    return (
      <EmbedCard icon={<ImageIcon />} title="Image">
        <EmbedCardHint>No image configured.</EmbedCardHint>
      </EmbedCard>
    );
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return <img className="max-w-full rounded-md" src={src} alt={alt} />;
  }
  if (src.startsWith("/")) {
    return <AuthenticatedImage src={src} alt={alt} />;
  }
  return (
    <EmbedCard icon={<ImageIcon />} title="Image">
      <EmbedCardHint>Unsupported image source: {src}</EmbedCardHint>
    </EmbedCard>
  );
}

/**
 * Same-origin media (e.g. `/uploaded_media/<id>`) needs auth headers, which a
 * plain `<img src>` can't attach — fetch the blob and render an object URL.
 */
function AuthenticatedImage({
  src,
  alt,
}: {
  src: string;
  alt: string;
}): JSX.Element {
  const { data, isLoading, error } = useEmbedQuery(["media", src], (client) =>
    client.fetchAuthenticatedMedia(src),
  );
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const url = URL.createObjectURL(data);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [data]);

  if (error) {
    return <EmbedCardError title="Image" error={error} />;
  }
  if (isLoading || !objectUrl) {
    return (
      <div className="h-40 w-full animate-pulse rounded-md bg-(--gray-3)" />
    );
  }
  return <img className="max-w-full rounded-md" src={objectUrl} alt={alt} />;
}
