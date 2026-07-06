import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { HogBrandingOptions } from "./hog-branding/extension";
import { createHogBrandingExtension } from "./hog-branding/extension";
import { createPosthogProviderExtension } from "./posthog-provider/extension";
import type { PosthogProviderOptions } from "./posthog-provider/provider";
import { createSubagentExtension } from "./subagent/extension";
import { createWebAccessExtension } from "./web-access/extension";

export type HarnessExtensionOptions = PosthogProviderOptions &
  HogBrandingOptions;

interface HarnessExtension {
  name: string;
  create: (options: HarnessExtensionOptions) => ExtensionFactory;
}

// `pi-mcp-adapter` ships raw, untranspiled TypeScript with no compiled entry
// point or `main`/`exports` field: it is only designed to be loaded by pi's
// own jiti-based extension loader via file path (the `-e` CLI flag, or
// `additionalExtensionPaths` in the SDK), not statically imported here. See
// `mcpAdapterExtensionFile()` in `spawn.ts` and its use in `cli.ts` and
// `session.ts` for how it is wired in as a file path instead of a factory.
const EXTENSIONS: HarnessExtension[] = [
  { name: "hog-branding", create: createHogBrandingExtension },
  { name: "posthog-provider", create: createPosthogProviderExtension },
  { name: "web-access", create: createWebAccessExtension },
  { name: "subagent", create: createSubagentExtension },
];

export const HARNESS_EXTENSION_NAMES: readonly string[] = EXTENSIONS.map(
  (extension) => extension.name,
);

export function harnessExtensions(
  options: HarnessExtensionOptions = {},
): ExtensionFactory[] {
  return EXTENSIONS.map((extension) => extension.create(options));
}
