import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Node `platform-arch` → codex target triple + the `@openai/codex` platform
 * sub-package that vendors the native binary. Mirrors the map in `@openai/codex`'s
 * own `bin/codex.js` shim (the sub-packages are aliased optional deps, e.g.
 * `@openai/codex-linux-arm64` = `npm:@openai/codex@<v>-linux-arm64`).
 */
const CODEX_NATIVE_TARGETS: Record<
  string,
  { triple: string; pkg: string } | undefined
> = {
  "linux-x64": {
    triple: "x86_64-unknown-linux-musl",
    pkg: "@openai/codex-linux-x64",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-musl",
    pkg: "@openai/codex-linux-arm64",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    pkg: "@openai/codex-darwin-x64",
  },
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    pkg: "@openai/codex-darwin-arm64",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    pkg: "@openai/codex-win32-x64",
  },
  "win32-arm64": {
    triple: "aarch64-pc-windows-msvc",
    pkg: "@openai/codex-win32-arm64",
  },
};

/**
 * Resolve the native codex binary vendored by the `@openai/codex` dependency's
 * platform sub-package, so the app-server adapter works from a plain
 * `npm install @posthog/agent` with no separate download step — the same way
 * Claude (an SDK dep) and codex-acp (npm platform binaries) ride along with the
 * package. Returns undefined when the dep (or this platform's sub-package, an
 * `os`/`cpu`-gated optional dep) isn't installed.
 */
function vendoredCodexBinary(): string | undefined {
  const target = CODEX_NATIVE_TARGETS[`${process.platform}-${process.arch}`];
  if (!target) return undefined;
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  try {
    // Anchor resolution at this module's directory so the dep is found in
    // @posthog/agent's node_modules (or a hoisted one). The filename passed to
    // createRequire need not exist — only its directory is used.
    const requireFrom = createRequire(
      join(import.meta.dirname ?? __dirname, "_resolve.js"),
    );
    const pkgJson = requireFrom.resolve(`${target.pkg}/package.json`);
    const binary = join(
      dirname(pkgJson),
      "vendor",
      target.triple,
      "bin",
      binaryName,
    );
    return existsSync(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Path to the native codex CLI (the one that exposes `app-server`), or undefined
 * when it isn't available (caller then keeps the codex-acp adapter).
 *
 * Two sources, in order:
 *  1. Bundled next to the codex-acp binary (the desktop's resources dir, where
 *     `download-binaries.mjs` places both).
 *  2. Vendored by the `@openai/codex` npm dependency — the install-time path that
 *     works everywhere `@posthog/agent` is installed (sandbox, CI), no download.
 */
export function nativeCodexBinaryPath(
  codexAcpPath?: string,
): string | undefined {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  if (codexAcpPath) {
    const candidate = join(dirname(codexAcpPath), binaryName);
    if (existsSync(candidate)) return candidate;
  }
  return vendoredCodexBinary();
}
