import { defineConfig, type Plugin } from "vite";
import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";

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

/**
 * Copy agent templates to the build directory
 */
function copyAgentTemplates(): Plugin {
  return {
    name: "copy-agent-templates",
    writeBundle() {
      const templateSrc = join(__dirname, "node_modules/@posthog/agent/dist/templates/plan-template.md");
      const templateDest = join(__dirname, ".vite/build/templates/plan-template.md");

      mkdirSync(join(__dirname, ".vite/build/templates"), { recursive: true });
      copyFileSync(templateSrc, templateDest);
      console.log("Copied agent templates to build directory");
    },
  };
}

export default defineConfig({
  plugins: [fixFilenameCircularRef(), copyAgentTemplates()],
  build: {
    target: "node18",
    minify: false, // Disable minification to prevent variable name conflicts
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
