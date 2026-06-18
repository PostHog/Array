import {
  buildImportMap,
  FREEFORM_BABEL_URL,
  FREEFORM_ESM_HOST,
} from "@posthog/core/canvas/freeformWhitelist";

// Builds the HTML document loaded into the freeform-canvas sandbox iframe.
//
// Security notes (see docs/canvas-freeform-react-plan.md):
//   - The iframe is mounted with sandbox="allow-scripts" and NO
//     allow-same-origin, so this document runs at a null origin: it cannot read
//     the host's cookies/storage or touch the host DOM. That is also why all
//     data access is postMessage, not a shared client object.
//   - The user's canvas code is NEVER interpolated into this HTML. It arrives
//     later as a postMessage `init` frame and is run from a Blob module URL, so
//     there is no string-injection path through the document itself.
//   - The CSP is the third isolation layer. Edit mode allows the esm.sh CDN (for
//     Babel + whitelisted packages). View/published mode (Phase 2) self-hosts
//     and forbids third-party egress entirely.
export type SandboxMode = "edit" | "view";

export function buildSandboxDocument(mode: SandboxMode): string {
  const importMap = JSON.stringify(buildImportMap());
  const csp = contentSecurityPolicy(mode);

  // The bootstrap module. It is static (no user input) so it can be inlined
  // safely. It waits for `init`, transpiles the canvas with Babel, runs it from
  // a Blob module (which resolves bare imports via the import map above), and
  // reports lifecycle + errors back to the host.
  const bootstrap = /* js */ `
    import * as Babel from "${FREEFORM_BABEL_URL}";
    const CHANNEL = "posthog-canvas";
    const post = (msg) => parent.postMessage({ channel: CHANNEL, ...msg }, "*");

    // --- data shim: the ONLY way canvas code reaches PostHog. No token here. ---
    const pending = new Map();
    let reqSeq = 0;
    const call = (method, payload) =>
      new Promise((resolve, reject) => {
        const id = String(++reqSeq);
        pending.set(id, { resolve, reject });
        post({ type: "data-request", id, method, payload });
      });
    window.ph = {
      // Run a named, server-stored query (the only shape allowed in view mode).
      run: (name, params) => call("run", { name, params: params ?? {} }),
      // Inline HogQL — edit mode only; rejected by the host in view mode.
      query: (hogql, params) => call("query", { hogql, params: params ?? {} }),
    };

    // --- error reporting (feeds the host's self-repair loop) ---
    const reportError = (message, stack) =>
      post({ type: "error", message: String(message ?? "Unknown error"), stack });
    window.addEventListener("error", (e) =>
      reportError(e.message, e.error && e.error.stack),
    );
    window.addEventListener("unhandledrejection", (e) =>
      reportError(
        (e.reason && e.reason.message) || e.reason,
        e.reason && e.reason.stack,
      ),
    );

    // --- size reporting so the host can grow the iframe (no inner scrollbar) ---
    const reportSize = () => {
      const h = document.documentElement.scrollHeight;
      post({ type: "resize", height: h });
    };

    let root = null;
    const mount = async (code) => {
      try {
        const out = Babel.transform(code, {
          filename: "canvas.tsx",
          presets: [
            ["react", { runtime: "automatic" }],
            ["typescript", { isTSX: true, allExtensions: true, onlyRemoveTypeImports: true }],
          ],
        }).code;
        const url = URL.createObjectURL(
          new Blob([out], { type: "text/javascript" }),
        );
        let mod;
        try {
          mod = await import(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const Comp = mod.default;
        if (typeof Comp !== "function") {
          throw new Error("Canvas must \`export default\` a React component.");
        }
        const React = await import("react");
        const { createRoot } = await import("react-dom/client");
        const el = document.getElementById("root");
        if (!root) root = createRoot(el);

        // Catch render-time throws so one bad render doesn't white-screen the
        // host; the error is reported and the host keeps showing last-good.
        class Boundary extends React.Component {
          constructor(p) { super(p); this.state = { error: null }; }
          static getDerivedStateFromError(error) { return { error }; }
          componentDidCatch(error) { reportError(error.message, error.stack); }
          render() {
            if (this.state.error) return null;
            return this.props.children;
          }
        }
        root.render(
          React.createElement(Boundary, null, React.createElement(Comp)),
        );
        // Let layout settle, then report success + size.
        requestAnimationFrame(() => {
          post({ type: "rendered" });
          reportSize();
          new ResizeObserver(reportSize).observe(document.documentElement);
        });
      } catch (err) {
        reportError(err && err.message, err && err.stack);
      }
    };

    window.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || d.channel !== CHANNEL) return;
      if (d.type === "init") {
        void mount(d.code);
      } else if (d.type === "data-response") {
        const p = pending.get(d.id);
        if (!p) return;
        pending.delete(d.id);
        d.ok ? p.resolve(d.result) : p.reject(new Error(d.error || "data error"));
      }
    });

    post({ type: "ready" });
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<script type="importmap">${importMap}</script>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #111; background: #fff; }
  #root { min-height: 100vh; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module">${bootstrap}</script>
</body>
</html>`;
}

// The iframe CSP (third isolation layer). `connect-src` matters most: in view
// mode it is locked to 'none' so a published canvas can't phone home, even if a
// dependency tries. Edit mode opens the CDN host only.
function contentSecurityPolicy(mode: SandboxMode): string {
  const esm = FREEFORM_ESM_HOST;
  if (mode === "edit") {
    return [
      "default-src 'none'",
      // Inline bootstrap + esm.sh modules + the transpiled Blob module.
      `script-src 'unsafe-inline' blob: ${esm}`,
      `style-src 'unsafe-inline' ${esm}`,
      `font-src data: ${esm}`,
      "img-src data: blob: https:",
      // esm.sh sub-fetches; canvas data goes over postMessage, not connect.
      `connect-src ${esm}`,
    ].join("; ");
  }
  // view / published: self-hosted, frozen, zero third-party egress.
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob: 'self'",
    "style-src 'unsafe-inline' 'self'",
    "font-src data: 'self'",
    "img-src data: blob: 'self'",
    "connect-src 'none'",
  ].join("; ");
}
