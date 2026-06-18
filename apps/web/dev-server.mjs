// Minimal dev host backend for apps/web.
//
// The web app's HOST_TRPC_CLIENT points at this over HTTP (the electron
// equivalent is the IPC-served host router). A real cloud backend is a future
// workstream; this serves just the boot-path procedures so the @posthog/ui app
// renders its real first screen (the login/auth screen) in a browser instead of
// hanging on the auth-bootstrap spinner.
//
// Plain JS so it runs under bare `node` with no TS toolchain — it depends only
// on @trpc/server, never on the workspace TS sources.

import { initTRPC } from "@trpc/server";
import { createHTTPServer } from "@trpc/server/adapters/standalone";

const PORT = 8787;

const t = initTRPC.create();
const router = t.router;
const publicProcedure = t.procedure;

// A bootstrapped, logged-out state. `bootstrapComplete: true` is what releases
// the app's Loading gate; `status: "anonymous"` makes it render the login screen.
const ANONYMOUS_BOOTSTRAPPED = {
  status: "anonymous",
  bootstrapComplete: true,
  cloudRegion: null,
  orgProjectsMap: {},
  currentOrgId: null,
  currentProjectId: null,
  hasCodeAccess: null,
  needsScopeReauth: false,
};

const appRouter = router({
  auth: router({
    getState: publicProcedure.query(() => ANONYMOUS_BOOTSTRAPPED),
    onStateChanged: publicProcedure.subscription(async function* (opts) {
      yield ANONYMOUS_BOOTSTRAPPED;
      // Hold the stream open until the client disconnects; tRPC aborts the
      // generator via opts.signal so this doesn't leak.
      await new Promise((resolve) => {
        opts.signal?.addEventListener("abort", () => resolve(undefined));
      });
    }),
  }),
  analytics: router({
    resetUser: publicProcedure.mutation(() => undefined),
    setUserId: publicProcedure.mutation(() => undefined),
  }),
});

createHTTPServer({
  router: appRouter,
  // Cross-origin: the Vite dev app is on :5273, this backend on :8787.
  middleware: (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    next();
  },
}).listen(PORT);

console.log(`[web dev-server] listening on http://localhost:${PORT}`);
