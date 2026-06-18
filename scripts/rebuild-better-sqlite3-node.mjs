// Rebuilds better-sqlite3's native binary for the CURRENT Node ABI.
//
// The Electron app's postinstall rebuilds better-sqlite3 against Electron's
// Node ABI (so the packaged app and `pnpm dev` can open the DB). That same
// binary cannot load under plain Node — vitest then dies with
// "Module did not self-register" / NODE_MODULE_VERSION mismatch. Run this
// before the workspace-server DB tests (CI does this in test.yml) to swap the
// binary back to a Node-ABI build. Re-run `pnpm install` (or the app's
// postinstall) to restore the Electron build before running the app again.
import { execFileSync } from "node:child_process";
import { realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const pkg = realpathSync("node_modules/better-sqlite3");
rmSync(`${pkg}/build`, { recursive: true, force: true });
rmSync(`${pkg}/prebuilds`, { recursive: true, force: true });

const prebuildInstall = createRequire(`${pkg}/`).resolve(
  "prebuild-install/bin.js",
);
execFileSync(process.execPath, [prebuildInstall], {
  cwd: pkg,
  stdio: "inherit",
});
