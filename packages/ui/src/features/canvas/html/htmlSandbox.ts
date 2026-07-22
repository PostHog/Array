import { buildAnnotationShimScript } from "./annotationShim";

// Composes the srcDoc for an HTML-artifact iframe. The frame itself is
// mounted with sandbox="allow-scripts" and NO allow-same-origin (null origin
// — no host cookies/storage/DOM), and this adds the two document-level
// pieces: a locked-down CSP and the annotation shim.
//
// The artifact bytes are otherwise untouched: both injections are plain
// string splices (never a parse/re-serialize round trip, which could alter
// the document the agent authored).

// No connect-src / script-src URLs / frame-src → fetch()/XHR, external
// scripts, and nested frames are all blocked; inline script+style keep the
// self-contained document (and the shim) working. https images/fonts stay
// allowed so a pasted-in document with a remote logo doesn't hard-break.
const HTML_ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; media-src data: blob:; form-action 'none'";

const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_CSP}">`;

export function buildHtmlArtifactDocument(html: string): string {
  let doc = html;

  // CSP first, as early in <head> as possible (a meta CSP only governs what
  // is parsed after it). No <head>? Splice one in after <html>; no <html>
  // either? Prepend — browsers hoist the meta into the synthesized head.
  const headOpen = doc.match(/<head(\s[^>]*)?>/i);
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    doc = `${doc.slice(0, at)}${CSP_META_TAG}${doc.slice(at)}`;
  } else {
    const htmlOpen = doc.match(/<html(\s[^>]*)?>/i);
    if (htmlOpen && htmlOpen.index !== undefined) {
      const at = htmlOpen.index + htmlOpen[0].length;
      doc = `${doc.slice(0, at)}<head>${CSP_META_TAG}</head>${doc.slice(at)}`;
    } else {
      doc = `${CSP_META_TAG}${doc}`;
    }
  }

  // The annotation shim goes at the END of <body> so the artifact DOM above it
  // is parsed when the shim runs (it posts `ready` immediately).
  const shimTag = `<script>${buildAnnotationShimScript()}</script>`;
  const bodyClose = doc.match(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  if (bodyClose && bodyClose.index !== undefined) {
    doc = `${doc.slice(0, bodyClose.index)}${shimTag}${doc.slice(bodyClose.index)}`;
  } else {
    doc = `${doc}${shimTag}`;
  }

  return doc;
}
