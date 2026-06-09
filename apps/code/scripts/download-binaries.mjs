#!/usr/bin/env node

import { execSync } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { extract } from "tar";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEST_DIR = join(__dirname, "..", "resources", "codex-acp");

const BINARIES = [
  {
    name: "codex-acp",
    version: "0.14.0",
    getUrl: (version, target) => {
      const ext = target.includes("windows") ? "zip" : "tar.gz";
      return `https://github.com/zed-industries/codex-acp/releases/download/v${version}/codex-acp-${version}-${target}.${ext}`;
    },
    getTarget: () => {
      const { platform, arch } = process;
      const targets = {
        darwin: { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" },
        linux: {
          arm64: "aarch64-unknown-linux-gnu",
          x64: "x86_64-unknown-linux-gnu",
        },
        win32: {
          arm64: "aarch64-pc-windows-msvc",
          x64: "x86_64-pc-windows-msvc",
        },
      };
      const platformTargets = targets[platform];
      if (!platformTargets)
        throw new Error(`Unsupported platform: ${platform}`);
      const target = platformTargets[arch];
      if (!target) throw new Error(`Unsupported arch: ${arch}`);
      return target;
    },
  },
  {
    name: "rg",
    version: "15.0.0",
    getUrl: (version, target) => {
      const ext = target.includes("windows") ? "zip" : "tar.gz";
      return `https://github.com/microsoft/ripgrep-prebuilt/releases/download/v${version}/ripgrep-v${version}-${target}.${ext}`;
    },
    getTarget: () => {
      const { platform, arch } = process;
      const targets = {
        darwin: { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" },
        linux: {
          arm64: "aarch64-unknown-linux-musl",
          x64: "x86_64-unknown-linux-musl",
        },
        win32: {
          arm64: "aarch64-pc-windows-msvc",
          x64: "x86_64-pc-windows-msvc",
        },
      };
      const platformTargets = targets[platform];
      if (!platformTargets)
        throw new Error(`Unsupported platform: ${platform}`);
      const target = platformTargets[arch];
      if (!target) throw new Error(`Unsupported arch: ${arch}`);
      return target;
    },
  },
];

export const MAX_DOWNLOAD_ATTEMPTS = 5;
const RETRIABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

class NonRetriableError extends Error {}

function backoffDelayMs(attempt) {
  const base = Math.min(1000 * 2 ** (attempt - 1), 15000);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

export async function downloadFile(url, destPath) {
  console.log(`  Downloading: ${url}`);
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        if (RETRIABLE_HTTP_STATUSES.has(response.status)) {
          throw new Error(message);
        }
        throw new NonRetriableError(message);
      }
      await pipeline(response.body, createWriteStream(destPath));
      console.log(`  Saved to: ${destPath}`);
      return;
    } catch (error) {
      if (
        error instanceof NonRetriableError ||
        attempt === MAX_DOWNLOAD_ATTEMPTS
      ) {
        throw error;
      }
      const delayMs = backoffDelayMs(attempt);
      console.warn(
        `  Attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${error.message}. Retrying in ${(delayMs / 1000).toFixed(1)}s...`,
      );
      await sleep(delayMs);
    }
  }
}

async function extractArchive(archivePath, destDir) {
  console.log(`  Extracting: ${archivePath}`);
  if (archivePath.endsWith(".zip")) {
    const { default: AdmZip } = await import("adm-zip");
    new AdmZip(archivePath).extractAllTo(destDir, true);
  } else {
    await extract({ file: archivePath, cwd: destDir });
  }
}

function signForMacOS(binaryPath) {
  console.log(`  Signing: ${binaryPath}`);
  try {
    execSync(`xattr -cr "${binaryPath}"`, { stdio: "pipe" });
  } catch {}
  execSync(`codesign --force --sign - "${binaryPath}"`, { stdio: "pipe" });
}

async function downloadBinary(binary) {
  const binaryName =
    process.platform === "win32" ? `${binary.name}.exe` : binary.name;
  const binaryPath = join(DEST_DIR, binaryName);

  console.log(`\n[${binary.name}] v${binary.version}`);

  if (existsSync(binaryPath)) {
    console.log(`  Already exists: ${binaryPath}`);
    return;
  }

  const target = binary.getTarget();
  const url = binary.getUrl(binary.version, target);
  const archiveName = `${binary.name}-archive${url.endsWith(".zip") ? ".zip" : ".tar.gz"}`;
  const archivePath = join(DEST_DIR, archiveName);

  console.log(`  Platform: ${process.platform}/${process.arch} -> ${target}`);

  await downloadFile(url, archivePath);
  await extractArchive(archivePath, DEST_DIR);
  rmSync(archivePath);

  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found after extraction: ${binaryPath}`);
  }

  if (process.platform !== "win32") {
    chmodSync(binaryPath, 0o755);
  }

  if (process.platform === "darwin") {
    signForMacOS(binaryPath);
  }

  console.log(`  Ready: ${binaryPath}`);
}

async function main() {
  console.log("Downloading binaries...");
  console.log(`Destination: ${DEST_DIR}`);

  if (!existsSync(DEST_DIR)) {
    mkdirSync(DEST_DIR, { recursive: true });
  }

  for (const binary of BINARIES) {
    await downloadBinary(binary);
  }

  console.log("\nDone.");
}

const isEntrypoint =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((err) => {
    console.error("\nFailed:", err.message);
    process.exit(1);
  });
}
