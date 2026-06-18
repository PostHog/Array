import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const SHUTDOWN_GRACE_MS = 3_000;
const WATCHDOG_INTERVAL_MS = 2_000;

function isParentAlive(parentPid: number): boolean {
  try {
    process.kill(parentPid, 0);
    return process.ppid === parentPid;
  } catch {
    return false;
  }
}

const sharedSecret = process.env.WORKSPACE_SERVER_SECRET;
const port = Number(process.env.WORKSPACE_SERVER_PORT);
const parentPid = Number(process.env.WORKSPACE_SERVER_PARENT_PID);

if (!sharedSecret || !Number.isInteger(port) || port <= 0 || port > 65_535) {
  process.stderr.write(
    "[workspace-server] missing or invalid WORKSPACE_SERVER_SECRET / WORKSPACE_SERVER_PORT\n",
  );
  process.exit(2);
}

const app = createApp({ sharedSecret });

let server: ReturnType<typeof serve> | null = null;
let shuttingDown = false;
const shutdown = (reason: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`[workspace-server] shutdown (${reason})\n`);
  if (!server) process.exit(0);
  server.close();
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (Number.isInteger(parentPid) && parentPid > 1) {
  setInterval(() => {
    if (!isParentAlive(parentPid)) shutdown("parent-exit");
  }, WATCHDOG_INTERVAL_MS).unref();
}

server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  process.stdout.write(
    `[workspace-server] listening on http://127.0.0.1:${info.port}\n`,
  );
});
