# Harness extensions

Every harness capability is a **pi.dev extension**: a proper, first-class extension pi loads
through its own extension machinery. Each one lives in its own folder here and follows the same
shape, so adding the Nth extension is mechanical.

## Convention

```
src/extensions/<extension-name>/
  extension.ts     # REQUIRED — the pi entry point
  ...              # any supporting modules the extension needs
```

`extension.ts` must:

1. `export default` a pi `ExtensionFactory` — `(pi: ExtensionAPI) => void | Promise<void>`.
   This is what `pi -e <path>` loads. It is zero-config; read any options from the environment.
2. `export` a named `create<Name>Extension(options)` that returns an `ExtensionFactory`.
   This is the configurable form used programmatically (CLI + SDK).

```ts
// src/extensions/<name>/extension.ts
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

export function createExampleExtension(options: ExampleOptions = {}): ExtensionFactory {
  return async (pi: ExtensionAPI) => {
    // pi.registerProvider(...) / pi.registerTool(...) / pi.on(...)
  };
}

export default function example(pi: ExtensionAPI): void | Promise<void> {
  return createExampleExtension()(pi);
}
```

## Registering it

Add one line to [`registry.ts`](./registry.ts):

```ts
const EXTENSIONS: HarnessExtension[] = [
  { name: "posthog-provider", create: createPosthogProviderExtension },
  { name: "example", create: createExampleExtension },
];
```

`registry.ts` is the single source of truth. Both entry paths consume it, so a registered extension
is loaded everywhere with no further wiring:

- **In-process CLI** (`src/cli.ts`) → `main(argv, { extensionFactories: harnessExtensions() })`
- **Subprocess** (`src/spawn.ts`) → one `-e dist/extensions/<name>/extension.js` per extension

Both are real pi extension-loading paths, verified to register in every pi mode (interactive, print,
rpc, json, and `--list-models`).
