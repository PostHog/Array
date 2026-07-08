function escapeForDoubleQuotes(path: string): string {
  return path.replace(/([$`"\\])/g, "\\$1");
}

// Single source of truth for the PATH `node` shim format: workspace-server
// writes it and the codex spawn path detects it by exact content.
export function buildNodeShimScript(execPath: string): string {
  return [
    "#!/bin/sh",
    "export ELECTRON_RUN_AS_NODE=1",
    `exec "${escapeForDoubleQuotes(execPath)}" "$@"`,
    "",
  ].join("\n");
}
