import { ErrorBoundary } from "@components/ErrorBoundary";
import { Flex, Text } from "@radix-ui/themes";
import {
  buildImageDataUrl,
  isAllowedImageMimeType,
} from "@shared/utils/imageDataUrl";
import { useState } from "react";

interface SafeImagePreviewProps {
  /** Base64-encoded image data (no data URL prefix). */
  base64: string;
  mimeType: string;
  alt?: string;
  className?: string;
  /** Rendered when the image fails to decode or has a disallowed mime type. */
  fallback?: React.ReactNode;
}

function DefaultFallback() {
  return (
    <Flex
      align="center"
      justify="center"
      className="size-full min-h-12 p-3 text-(--gray-11)"
    >
      <Text className="text-[13px]">Unable to render image preview</Text>
    </Flex>
  );
}

function SafeImagePreviewInner({
  base64,
  mimeType,
  alt,
  className,
  fallback,
}: SafeImagePreviewProps) {
  const [hasError, setHasError] = useState(false);

  if (!isAllowedImageMimeType(mimeType) || base64.length === 0) {
    return <>{fallback ?? <DefaultFallback />}</>;
  }

  if (hasError) {
    return <>{fallback ?? <DefaultFallback />}</>;
  }

  return (
    <img
      src={buildImageDataUrl(mimeType, base64)}
      alt={alt ?? "image preview"}
      className={className ?? "max-h-full max-w-full object-contain"}
      onError={() => setHasError(true)}
    />
  );
}

export function SafeImagePreview(props: SafeImagePreviewProps) {
  return (
    <ErrorBoundary
      name="safe-image-preview"
      fallback={props.fallback ?? <DefaultFallback />}
    >
      <SafeImagePreviewInner {...props} />
    </ErrorBoundary>
  );
}
