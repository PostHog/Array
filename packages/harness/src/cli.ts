#!/usr/bin/env node

import { main } from "@earendil-works/pi-coding-agent";
import { harnessExtensions } from "./extensions/registry";

main(process.argv.slice(2), {
  extensionFactories: harnessExtensions(),
});
