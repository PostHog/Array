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
  return blob;
}
