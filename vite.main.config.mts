import { defineConfig, type Plugin } from "vite";

/**
 * Custom Vite plugin to fix circular __filename references in bundled ESM packages.
 *
 * When Vite bundles ESM packages like @posthog/agent that use import.meta.url,
 * it transforms them into a complex polyfill that creates circular references:
 * `const __filename2 = fileURLToPath(... pathToFileURL(__filename2) ...)`
 *
 * This plugin post-processes the bundle to replace the circular reference with
 * a simple assignment to Node.js's global __filename variable.
 */
function fixFilenameCircularRef(): Plugin {
  return {
    name: "fix-filename-circular-ref",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk") {
          // Replace circular __filename references with direct __filename usage
          chunk.code = chunk.code.replace(
            /const __filename(\d+) = url\.fileURLToPath\(typeof document === "undefined" \? require\("url"\)\.pathToFileURL\(__filename\1\)\.href : [^;]+\);/g,
            "const __filename$1 = __filename;",
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [fixFilenameCircularRef()],
  build: {
    target: "node18",
    minify: false, // Disable minification to prevent variable name conflicts
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
