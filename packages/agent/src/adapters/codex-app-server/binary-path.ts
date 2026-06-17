import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The native codex CLI is bundled next to codex-acp, so derive its path from
 * the codex-acp binary path (same directory, `codex` instead of `codex-acp`).
 * Returns undefined when the binary isn't present (e.g. the npx fallback), in
 * which case the caller keeps using the codex-acp adapter.
 */
export function nativeCodexBinaryPath(
  codexAcpPath?: string,
): string | undefined {
  if (!codexAcpPath) return undefined;
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const candidate = join(dirname(codexAcpPath), binaryName);
  return existsSync(candidate) ? candidate : undefined;
}
