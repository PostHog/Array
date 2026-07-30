import { getImageMimeType, isAllowedImageMimeType } from "@posthog/shared";
import { applyCspToHtml } from "../../mcp-apps/utils/mcp-app-csp";
import { injectArtifactHtmlCommentBridge } from "./artifactHtmlCommentBridge";

export function artifactHtmlDocument(
  html: string,
  commentBridgeChannel?: string,
): string {
  const document = commentBridgeChannel
    ? injectArtifactHtmlCommentBridge(html, commentBridgeChannel)
    : html;
  // HTML artifacts stay in an opaque-origin sandbox. Allow authored HTTPS
  // resources so generated reports retain their CSS, fonts, images and static
  // scripts, while denying API connections, forms, nested frames and objects.
  return applyCspToHtml(document, { resourceDomains: ["https:"] });
}
export async function artifactPreviewBlob(
  blob: Blob,
  filename: string,
): Promise<Blob> {
  const filenameMimeType = getImageMimeType(filename);
  const imageMimeType = isAllowedImageMimeType(blob.type)
    ? blob.type.toLowerCase()
    : filenameMimeType;

  if (isAllowedImageMimeType(imageMimeType)) {
    return new Blob([blob], { type: imageMimeType });
  }
  // SVG is kept out of the <img> allowlist because its scripts would run from a
  // data URL, but the generic preview renders it in an opaque-origin iframe
  // with scripts already blocked — so it's safe there and just needs the right
  // type, or the browser offers a download instead of drawing it.
  if (filenameMimeType === "image/svg+xml") {
    return new Blob([blob], { type: "image/svg+xml" });
  }
  return blob;
}
