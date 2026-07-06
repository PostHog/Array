#!/usr/bin/env node

import { main } from "@earendil-works/pi-coding-agent";
import { harnessExtensionFiles } from "./spawn";

// Load every harness extension by file path (rather than via
// `extensionFactories`) so each shows its real name in the startup banner
// instead of `<inline:N>`; pi's loader only has a display name to show when
// an extension is loaded from a path.
const extensionArgs = harnessExtensionFiles().flatMap((file) => ["-e", file]);
main([...extensionArgs, ...process.argv.slice(2)]);
