#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_READY = new RegExp(
  `(localhost|127\\.0\\.0\\.1|\\[::1\\]):${DEV_SERVER_PORT}`,
);

const children = [];
let shuttingDown = false;

function killAll(signal = "SIGTERM") {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function onSpawnError(label) {
  return (err) => {
    console.error(`Failed to start ${label}: ${err.message}`);
    killAll("SIGTERM");
    process.exit(1);
  };
}

process.on("SIGINT", () => {
  killAll("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll("SIGTERM");
  process.exit(0);
});

async function main() {
  const rendererServer = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--config",
      "vite.renderer.config.mts",
      "--port",
      String(DEV_SERVER_PORT),
      "--strictPort",
      "--mode",
      "development",
    ],
    {
      cwd: root,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );
  children.push(rendererServer);
  rendererServer.on("error", onSpawnError("renderer dev server"));
  rendererServer.on("close", (code) => {
    killAll("SIGTERM");
    process.exit(code ?? 0);
  });

  let devServerUrl = null;
  const watchReady = { main: false, preload: false, ws: false };

  function isReady() {
    return (
      devServerUrl !== null &&
      watchReady.main &&
      watchReady.preload &&
      watchReady.ws
    );
  }

  let electronStarted = false;

  function maybeStartElectron() {
    if (!isReady() || electronStarted) return;
    electronStarted = true;

    const inspectArg = process.env.ELECTRON_INSPECT
      ? [`--inspect=${process.env.ELECTRON_INSPECT}`]
      : [];

    const electron = spawn(
      "pnpm",
      ["exec", "electron", ".", "--remote-debugging-port=9222", ...inspectArg],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          VITE_DEV_SERVER_URL: devServerUrl,
        },
      },
    );
    children.push(electron);
    electron.on("error", onSpawnError("electron"));
    electron.on("close", (code) => {
      killAll("SIGTERM");
      process.exit(code ?? 0);
    });
  }

  function forwardAndCheck(stream, dest, onLine) {
    stream.setEncoding("utf8");
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        dest.write(`${line}\n`);
        onLine(line);
        nl = buf.indexOf("\n");
      }
    });
    stream.on("end", () => {
      if (buf) {
        dest.write(buf);
        onLine(buf);
      }
    });
  }

  forwardAndCheck(rendererServer.stdout, process.stdout, (line) => {
    if (devServerUrl === null && DEV_SERVER_READY.test(line)) {
      devServerUrl = `http://localhost:${DEV_SERVER_PORT}`;
      maybeStartElectron();
    }
  });
  forwardAndCheck(rendererServer.stderr, process.stderr, () => {});

  const builtPattern = /built in|watching for file changes/i;

  function startWatchBuild(config, readyKey) {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "vite",
        "build",
        "--config",
        config,
        "--watch",
        "--mode",
        "development",
      ],
      {
        cwd: root,
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
    children.push(child);
    child.on("error", onSpawnError(`vite watch (${readyKey})`));
    child.on("close", (code) => {
      if (shuttingDown || code === 0) return;
      console.error(`vite watch (${readyKey}) exited with code ${code}`);
      killAll("SIGTERM");
      process.exit(code ?? 1);
    });
    forwardAndCheck(child.stdout, process.stdout, (line) => {
      if (!watchReady[readyKey] && builtPattern.test(line)) {
        watchReady[readyKey] = true;
        maybeStartElectron();
      }
    });
    forwardAndCheck(child.stderr, process.stderr, () => {});
  }

  startWatchBuild("vite.main.config.mts", "main");
  startWatchBuild("vite.preload.config.mts", "preload");
  startWatchBuild("vite.workspace-server.config.mts", "ws");
}

main().catch((err) => {
  console.error(err.message);
  killAll("SIGTERM");
  process.exit(1);
});
