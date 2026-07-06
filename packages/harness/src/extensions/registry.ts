import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createPosthogProviderExtension } from "./posthog-provider/extension";
import type { PosthogProviderOptions } from "./posthog-provider/provider";

export type HarnessExtensionOptions = PosthogProviderOptions;

interface HarnessExtension {
  name: string;
  create: (options: HarnessExtensionOptions) => ExtensionFactory;
}

const EXTENSIONS: HarnessExtension[] = [
  { name: "posthog-provider", create: createPosthogProviderExtension },
];

export const HARNESS_EXTENSION_NAMES: readonly string[] = EXTENSIONS.map(
  (extension) => extension.name,
);

export function harnessExtensions(
  options: HarnessExtensionOptions = {},
): ExtensionFactory[] {
  return EXTENSIONS.map((extension) => extension.create(options));
}
