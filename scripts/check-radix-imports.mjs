#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["packages", "apps"];
const ALLOWED_THEMES_IMPORTS = new Set(["Box", "Flex", "Text"]);

const USAGE = `check-radix-imports — Radix is frozen; new UI comes from @posthog/quill.

  node scripts/check-radix-imports.mjs [base]   fail on Radix imports added since <base>
                                                (default: merge-base with origin/main)

Only Box, Flex, and Text from @radix-ui/themes are permitted in new code. Every
other Radix component and every other @radix-ui/* package is frozen: existing
imports may stay until migrated, but a changed file must not gain any.`;

// Matches static imports, re-exports, and dynamic imports of Radix packages.
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?([\w$]+|\*\s+as\s+[\w$]+|\{[^}]*\}|[\w$]+\s*,\s*\{[^}]*\}|\*)?\s*(?:from\s*)?["'](@radix-ui\/[^"']+|radix-ui(?:\/[^"']*)?)["']/g;
const DYNAMIC_RE =
  /import\s*\(\s*["'](@radix-ui\/[^"']+|radix-ui(?:\/[^"']*)?)["']\s*\)/g;

function git(cmd) {
  return execSync(`git -C "${ROOT}" ${cmd}`, { encoding: "utf8" });
}

function importedNames(clause) {
  if (!clause) return ["*"]; // bare `import "pkg"` — side-effect import
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (let n of braces[1].split(",")) {
      n = n.trim().replace(/^type\s+/, "");
      if (!n) continue;
      names.push(n.split(/\s+as\s+/)[0].trim());
    }
  }
  const outside = clause
    .replace(/\{[^}]*\}/, "")
    .replace(/,\s*$/, "")
    .trim();
  if (outside) names.push("*"); // default, namespace, or star import — all names reachable
  return names.length ? names : ["*"];
}

function frozenImports(src) {
  const hits = new Set();
  IMPORT_RE.lastIndex = 0;
  for (let m = IMPORT_RE.exec(src); m; m = IMPORT_RE.exec(src)) {
    const [, clause, spec] = m;
    if (spec === "@radix-ui/themes") {
      for (const name of importedNames(clause)) {
        if (!ALLOWED_THEMES_IMPORTS.has(name)) hits.add(`${spec}#${name}`);
      }
    } else {
      hits.add(spec);
    }
  }
  DYNAMIC_RE.lastIndex = 0;
  for (let m = DYNAMIC_RE.exec(src); m; m = DYNAMIC_RE.exec(src)) {
    hits.add(m[1] === "@radix-ui/themes" ? `${m[1]}#*` : m[1]);
  }
  return hits;
}

const arg = process.argv[2];
if (arg === "--help" || arg === "-h") {
  console.log(USAGE);
  process.exit(0);
}

let base = arg;
if (!base) {
  try {
    base = git("merge-base origin/main HEAD").trim();
  } catch {
    base = "origin/main";
  }
}

const isSource = (f) =>
  /\.tsx?$/.test(f) &&
  !f.endsWith(".d.ts") &&
  !f.includes("/generated") &&
  SCAN_ROOTS.some((r) => f.startsWith(`${r}/`));

const changed = new Set(
  [
    ...git(`diff --name-only --diff-filter=ACMR ${base}`).split("\n"),
    ...git("ls-files --others --exclude-standard").split("\n"),
  ]
    .map((f) => f.trim())
    .filter(Boolean)
    .filter(isSource),
);

const fresh = [];
for (const file of changed) {
  let head;
  try {
    head = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue; // deleted in worktree
  }
  if (!head.includes("radix-ui")) continue;
  let baseSrc = "";
  try {
    baseSrc = git(`show ${base}:"${file}"`);
  } catch {
    // new file — everything counts as added
  }
  const before = frozenImports(baseSrc);
  for (const entry of frozenImports(head)) {
    if (!before.has(entry)) fresh.push({ file, entry });
  }
}

if (fresh.length) {
  console.error(
    `\n✗ ${fresh.length} NEW Radix import(s) since ${base.slice(0, 12)} — Radix is frozen; new UI comes from @posthog/quill:\n`,
  );
  for (const { file, entry } of fresh) console.error(`  ${file}\n    ${entry}`);
  console.error(
    `\nOnly Box, Flex, and Text from @radix-ui/themes are allowed in new code. Use the
@posthog/quill equivalent (Button, Dialog*, Tooltip*, DropdownMenu*, ...) instead.`,
  );
  process.exit(1);
}

console.log(
  `✓ No new Radix imports in ${changed.size} changed file(s) vs ${base.slice(0, 12)}.`,
);
