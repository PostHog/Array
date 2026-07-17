import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createBackgroundJobsExtension } from "./background-jobs/extension";
import type { HogBrandingOptions } from "./hog-branding/extension";
import { createHogBrandingExtension } from "./hog-branding/extension";
import { createMcpExtension } from "./mcp/extension";
import { createPosthogProviderExtension } from "./posthog-provider/extension";
import type { PosthogProviderOptions } from "./posthog-provider/provider";
import { createSubagentExtension } from "./subagent/extension";
import { createWebAccessExtension } from "./web-access/extension";
import { createWorkflowExtension } from "./workflow/extension";

export type HarnessExtensionOptions = PosthogProviderOptions &
  HogBrandingOptions;

interface HarnessExtension {
  name: string;
  create: (options: HarnessExtensionOptions) => ExtensionFactory;
}

const EXTENSIONS: HarnessExtension[] = [
  { name: "hog-branding", create: createHogBrandingExtension },
  { name: "posthog-provider", create: createPosthogProviderExtension },
  { name: "web-access", create: createWebAccessExtension },
  { name: "background-jobs", create: () => createBackgroundJobsExtension() },
  { name: "subagent", create: createSubagentExtension },
  { name: "workflow", create: createWorkflowExtension },
  // createMcpExtension's options are test seams (config loader, transport
  // factory), not HarnessExtensionOptions, so drop the registry options.
  { name: "mcp", create: () => createMcpExtension() },
];

export const HARNESS_EXTENSION_NAMES: readonly string[] = EXTENSIONS.map(
  (extension) => extension.name,
);

export function harnessExtensions(
  options: HarnessExtensionOptions = {},
): ExtensionFactory[] {
  return EXTENSIONS.map((extension) => extension.create(options));
}
