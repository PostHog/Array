#!/usr/bin/env node

import {
  formatHogBrandBanner,
  installHogBrandEnv,
  isHelpRequest,
} from "./extensions/hog-branding/brand-env";
// Must run — and finish running — before `@earendil-works/pi-coding-agent`
// is evaluated, so pi picks up "hog" branding when its config module first
// evaluates. `installHogBrandEnv` itself only touches Node builtins, so
// this static import carries no ordering risk; everything below that
// touches pi-coding-agent (directly or transitively, e.g. `./spawn`, which
// pulls in every extension) is loaded dynamically instead of via a static
// import — see `./extensions/hog-branding/brand-env` for why a static
// import here wouldn't reliably run first once bundled, and why `./spawn`
// below is imported by a *computed* (non-literal) specifier: a literal
// `import("./spawn")` is exactly as statically inlinable (and thus exactly
// as unordered) as a static `import`, since bundlers resolve and inline
// literal-specifier dynamic imports when there's no code-splitting. A
// specifier the bundler can't statically resolve forces a genuine runtime
// load of the already-separately-built `dist/spawn.js`.
import type * as SpawnModule from "./spawn";

installHogBrandEnv();

const { main, VERSION } = await import("@earendil-works/pi-coding-agent");
const spawnModuleUrl = new URL("./spawn.js", import.meta.url).href;
const { harnessExtensionFiles }: typeof SpawnModule = await import(
  spawnModuleUrl
);

// pi generates its own `--help` text (see `cli/args.js`'s `printHelp()`)
// from `APP_NAME` alone, with no tagline — print ours first.
if (isHelpRequest(process.argv.slice(2))) {
  console.log(`${formatHogBrandBanner(VERSION)}\n`);
}

// Load every harness extension by file path (rather than via
// `extensionFactories`) so each shows its real name in the startup banner
// instead of `<inline:N>`; pi's loader only has a display name to show when
// an extension is loaded from a path.
const extensionArgs = harnessExtensionFiles().flatMap((file: string) => [
  "-e",
  file,
]);
main([...extensionArgs, ...process.argv.slice(2)]);
