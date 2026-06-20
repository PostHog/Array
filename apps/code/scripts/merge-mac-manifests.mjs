#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

const [, , arm64Path, x64Path, outputPath] = process.argv;

if (!arm64Path || !x64Path || !outputPath) {
  console.error(
    "Usage: merge-mac-manifests.mjs <arm64-yml> <x64-yml> <output-yml>",
  );
  process.exit(1);
}

const arm64 = parse(readFileSync(arm64Path, "utf8"));
const x64 = parse(readFileSync(x64Path, "utf8"));

const seenUrls = new Set();
const mergedFiles = [];

for (const file of [...arm64.files, ...x64.files]) {
  if (!seenUrls.has(file.url)) {
    seenUrls.add(file.url);
    mergedFiles.push(file);
  }
}

const merged = { ...arm64, files: mergedFiles };

writeFileSync(outputPath, stringify(merged), "utf8");
console.log(
  `Merged ${mergedFiles.length} files from arm64+x64 manifests -> ${outputPath}`,
);
