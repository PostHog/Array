#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DEV_SERVER_PORT = 5173;

const children = [];

function killAll(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => {
  killAll("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll("SIGTERM");
  process.exit(0);
});

function spawnVite(args, { onLine } = {}) {
  const child = spawn("pnpm", ["exec", "vite", ...args], {
    cwd: root,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.push(child);

  function relay(stream, dest) {
    stream.setEncoding("utf8");
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        dest.write(line + "\n");
        if (onLine) onLine(line);
      }
    });
    stream.on("end", () => {
      if (buf) {
        dest.write(buf);
        if (onLine) onLine(buf);
      }
    });
  }

  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  return child;
}

function waitForLine(child, pattern) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handlers = {
      stdout: [],
      stderr: [],
    };

    function check(line) {
      if (settled) return;
      if (pattern.test(line)) {
        settled = true;
        resolve(line);
      }
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    let stdoutBuf = "";
    let stderrBuf = "";

    function processBuffer(buf, remaining, stream) {
      buf += remaining;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        process[stream].write(line + "\n");
        check(line);
      }
      return buf;
    }

    child.stdout.on("data", (chunk) => {
      stdoutBuf = processBuffer(stdoutBuf, chunk, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf = processBuffer(stderrBuf, chunk, "stderr");
    });
    child.on("close", (code) => {
      if (!settled) {
        reject(
          new Error(`Process exited with code ${code} before pattern matched`),
        );
      }
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

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
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        dest.write(line + "\n");
        onLine(line);
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
    if (devServerUrl === null && line.includes(`localhost:${DEV_SERVER_PORT}`)) {
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
    forwardAndCheck(child.stdout, process.stdout, (line) => {
      if (!watchReady[readyKey] && builtPattern.test(line)) {
        watchReady[readyKey] = true;
        maybeStartElectron();
      }
    });
    forwardAndCheck(child.stderr, process.stderr, () => {});
    return child;
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
