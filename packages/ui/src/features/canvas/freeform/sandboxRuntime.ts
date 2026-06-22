import {
  buildImportMap,
  FREEFORM_BABEL_URL,
  FREEFORM_ESM_HOST,
  FREEFORM_POSTHOG_JS_URL,
  FREEFORM_QUILL_CSS_URLS,
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

export function buildSandboxDocument(
  mode: SandboxMode,
  // The PostHog host, when in-iframe analytics/replay is enabled. Opens CSP for
  // posthog-js to load its recorder and POST events/replay to ingest.
  analyticsApiHost?: string,
): string {
  const importMap = JSON.stringify(buildImportMap());
  const csp = contentSecurityPolicy(mode, analyticsApiHost);

  // Quill components emit Tailwind utility classes (layout — `inline-flex`,
  // `items-center` — AND token colors like `bg-card`, `text-muted-foreground`)
  // ALONGSIDE their `.quill-*` BEM classes. The linked Quill stylesheets style
  // the BEM half; the utilities are dead without Tailwind, so components mislay
  // out. The sandbox has no build step, so in EDIT mode we load the Tailwind Play
  // CDN (JIT-in-browser; a MutationObserver picks up classes as the app mounts)
  // and map Quill's semantic color tokens to the CSS variables tokens.css defines.
  // View/published mode forbids the CDN (locked egress) — that tier must self-host
  // a compiled stylesheet (Phase 2).
  const tailwind =
    mode === "edit"
      ? `<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
  // Preflight OFF: its UNLAYERED form reset (e.g. \`button{background-color:transparent}\`)
  // beats Quill's component styles, which live in \`@layer components\` — unlayered always
  // wins over layered. That stripped Quill buttons (e.g. the Select trigger) of their
  // border/background while box-shadow-bordered Cards survived. Quill self-styles and we
  // ship our own minimal reset, so Preflight isn't needed; utilities still generate.
  // The FULL Quill color/fill token map (mirrors the @theme inline block in
  // quill/tokens.css). Pure-utility components like DateTimePicker have NO BEM
  // fallback in primitives.css — they rely entirely on these utilities (e.g. the
  // calendar's \`bg-fill-hover\`, \`bg-fill-selected\`), so every token Quill maps
  // must be here or the component renders half-styled.
  corePlugins: { preflight: false },
  // Drive \`dark:\` utilities off the \`.dark\` class (which the host toggles via
  // the init theme), NOT prefers-color-scheme — so the canvas follows the user's
  // PostHog theme, matching the main app, even when it differs from the OS.
  darkMode: "class",
  plugins: [
    // Quill authors for Tailwind v4; \`not-disabled:\` is a v4 variant the Play
    // CDN (v3) lacks. The calendar uses \`not-disabled:hover:bg-fill-hover\`, so
    // register it (composes with \`hover:\`) or those day-cell styles never generate.
    tailwind.plugin(({ addVariant }) => {
      addVariant("not-disabled", "&:not(:disabled)");
    }),
  ],
  theme: { extend: {
    colors: {
      border: "var(--border)", input: "var(--input)", ring: "var(--ring)",
      background: "var(--background)", foreground: "var(--foreground)",
      chrome: "var(--chrome)",
      primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
      secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
      destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
      muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
      accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
      popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
      card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
      success: { DEFAULT: "var(--success)", foreground: "var(--success-foreground)" },
      warning: { DEFAULT: "var(--warning)", foreground: "var(--warning-foreground)" },
      info: { DEFAULT: "var(--info)", foreground: "var(--info-foreground)" },
      // Surface fills the calendar (and other stateful primitives) use for
      // hover / selected / expanded backgrounds.
      fill: {
        hover: "var(--fill-hover)",
        selected: "var(--fill-selected)",
        expanded: "var(--fill-expanded)",
      },
    },
    borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
  } } };
</script>`
      : "";

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
    // posthog-js runs IN here (the only way replay records the app's DOM). It is
    // booted by init when analytics config is present; until then capture falls
    // back to the host-mediated path.
    let phClient = null;
    window.ph = {
      // Run a named, server-stored query (the only shape allowed in view mode).
      run: (name, params) => call("run", { name, params: params ?? {} }),
      // Run a query. Pass a TYPED query node (\`{ kind: "TrendsQuery", … }\`) for
      // UI-matching numbers (preferred), or an inline HogQL string (escape hatch).
      // Edit mode only; rejected by the host in view mode.
      query: (queryOrHogql, params) =>
        call(
          "query",
          typeof queryOrHogql === "string"
            ? { hogql: queryOrHogql, params: params ?? {} }
            : { query: queryOrHogql, params: params ?? {} },
        ),
      // Send an analytics event. Prefer in-iframe posthog-js (so it shares the
      // session/replay); otherwise host-mediated (no replay, still captured).
      capture: (event, properties, distinctId) => {
        if (phClient) {
          phClient.capture(event, properties ?? {});
          return Promise.resolve({ ok: true });
        }
        return call("capture", { event, properties: properties ?? {}, distinctId });
      },
      // Navigate the host app. Fire-and-forget: the host validates the intent
      // against its allowlist and routes within the current channel. The canvas
      // cannot pick the channel or an arbitrary path — only these four targets.
      navigate: {
        toTask: (taskId) => post({ type: "navigate", nav: { target: "task", taskId } }),
        toNewTask: () => post({ type: "navigate", nav: { target: "new-task" } }),
        toCanvas: (dashboardId) => post({ type: "navigate", nav: { target: "canvas", dashboardId } }),
        toNewCanvas: () => post({ type: "navigate", nav: { target: "new-canvas" } }),
      },
    };

    // Boot posthog-js with the PUBLIC key the host passed in (never the read
    // token). Enables session replay so the author/viewer can be watched.
    const bootAnalytics = async (cfg) => {
      if (phClient || !cfg) return;
      try {
        const mod = await import("${FREEFORM_POSTHOG_JS_URL}");
        const posthog = mod.default || mod.posthog || mod;
        posthog.init(cfg.publicKey, {
          api_host: cfg.apiHost,
          // No storage on a null-origin sandbox → memory session; the
          // usercontent origin (shared tier) persists per-viewer.
          persistence: cfg.persist ? "localStorage+cookie" : "memory",
          capture_pageview: false,
          disable_session_recording: false,
          loaded: (ph) => {
            if (cfg.distinctId) ph.identify(cfg.distinctId);
          },
        });
        phClient = posthog;
        window.posthog = posthog;
      } catch (err) {
        reportError(
          "analytics init failed: " + (err && err.message),
          err && err.stack,
        );
      }
    };

    // --- theme: mirror the host's light/dark by toggling \`.dark\` on the root,
    // exactly as the main app does. Quill's CSS tokens (:root / .dark) and the
    // \`dark:\` Tailwind utilities both key off this class, so the whole canvas
    // flips. Applied on init and on every live \`set-theme\` frame.
    const applyTheme = (theme) =>
      document.documentElement.classList.toggle("dark", theme === "dark");

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
    // Observe size ONCE for the iframe's life. mount() runs on every streamed
    // code snapshot, so creating the observer there would leak one per snapshot
    // and multiply resize messages.
    new ResizeObserver(reportSize).observe(document.documentElement);

    let root = null;
    // mount() is async and is called once per streamed code snapshot, so several
    // runs overlap on their awaits. Without ordering, a slower EARLIER (partial,
    // often invalid) snapshot could run root.render last and clobber the latest
    // good render — the bug where live edits don't appear until you revisit.
    // A monotonic sequence makes only the newest mount commit its render/error;
    // superseded runs bail out after each await.
    let mountSeq = 0;
    const mount = async (code) => {
      const seq = ++mountSeq;
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
        if (seq !== mountSeq) return; // a newer snapshot superseded this one
        const Comp = mod.default;
        if (typeof Comp !== "function") {
          throw new Error("Canvas must \`export default\` a React component.");
        }
        const React = await import("react");
        const { createRoot } = await import("react-dom/client");
        if (seq !== mountSeq) return;
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
          if (seq !== mountSeq) return;
          post({ type: "rendered" });
          reportSize();
        });
      } catch (err) {
        // Only the latest snapshot reports — a superseded partial's parse error
        // must not surface as the canvas's error or flicker the host banner.
        if (seq === mountSeq) reportError(err && err.message, err && err.stack);
      }
    };

    window.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || d.channel !== CHANNEL) return;
      if (d.type === "init") {
        applyTheme(d.theme);
        if (d.analytics) void bootAnalytics(d.analytics);
        void mount(d.code);
      } else if (d.type === "set-theme") {
        // Re-theme in place — no mount(), so the app keeps all its state.
        applyTheme(d.theme);
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
${tailwind}
${FREEFORM_QUILL_CSS_URLS.map(
  (href) => `<link rel="stylesheet" href="${href}" />`,
).join("\n")}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  /* Track the theme via Quill's tokens (set on :root / .dark) so the page chrome
     flips with the host theme; fall back to light if the tokens haven't loaded. */
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--foreground, #111); background: var(--background, #fff); }
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
// mode it is otherwise locked down so a published canvas can't phone home. When
// analytics/replay is on we open ONLY the PostHog ingest + assets hosts (so
// posthog-js can load its recorder and POST events/replay) — never arbitrary
// egress.
function contentSecurityPolicy(
  mode: SandboxMode,
  analyticsApiHost?: string,
): string {
  const esm = FREEFORM_ESM_HOST;
  // posthog-js posts events to the api host and loads the recorder from the
  // region assets host; allow both. Wildcards cover PostHog Cloud regions; the
  // explicit api host covers self-hosted.
  const ph = analyticsApiHost
    ? `${analyticsApiHost} https://*.posthog.com https://*.i.posthog.com`
    : "";

  if (mode === "edit") {
    return [
      "default-src 'none'",
      // Inline bootstrap + esm.sh modules + the transpiled Blob module + the
      // posthog-js recorder script + the Tailwind Play CDN (which JIT-compiles
      // in-browser, so it needs 'unsafe-eval'). The CDN is edit-mode ONLY — view
      // mode keeps egress locked and self-hosts styles instead.
      `script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.tailwindcss.com ${esm} ${ph}`,
      `style-src 'unsafe-inline' ${esm}`,
      `font-src data: ${esm}`,
      "img-src data: blob: https:",
      `worker-src blob:`,
      // esm.sh sub-fetches; canvas DATA goes over postMessage (not connect), but
      // posthog-js events/replay DO use connect to the PostHog hosts.
      `connect-src ${esm} ${ph}`,
    ].join("; ");
  }
  // view / published: self-hosted, frozen. Only egress is PostHog analytics.
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' blob: 'self' ${ph}`,
    "style-src 'unsafe-inline' 'self'",
    "font-src data: 'self'",
    "img-src data: blob: 'self'",
    `worker-src blob:`,
    `connect-src 'self' ${ph}`,
  ].join("; ");
}
