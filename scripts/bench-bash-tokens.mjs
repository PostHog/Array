#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "posthog-bash-token-bench-"));
const fixture = join(root, "fixture");
mkdirSync(fixture);

function run(bin, args, cwd = fixture) {
  const startedAt = performance.now();
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
    durationMs: performance.now() - startedAt,
    error: result.error?.message,
  };
}

function estimatedTokens(output) {
  return Math.ceil(Buffer.byteLength(output, "utf8") / 4);
}

function createFixture() {
  const sourceDir = join(fixture, "src");
  mkdirSync(sourceDir);
  for (let fileIndex = 0; fileIndex < 80; fileIndex++) {
    const lines = [];
    for (let lineIndex = 0; lineIndex < 80; lineIndex++) {
      lines.push(
        `export const repeated_${fileIndex}_${lineIndex} = "TOKEN_BENCH_MATCH shared diagnostic payload ${lineIndex}";`,
      );
    }
    lines.push(`export const unique_${fileIndex} = "UNIQUE_FILE_${fileIndex}";`);
    writeFileSync(join(sourceDir, `module-${String(fileIndex).padStart(3, "0")}.ts`), `${lines.join("\n")}\n`);
  }

  const generated = {};
  for (let index = 0; index < 1200; index++) {
    generated[`property_${String(index).padStart(4, "0")}`] = {
      status: index % 3 === 0 ? "active" : "inactive",
      value: `TOKEN_BENCH_JSON_${index}`,
    };
  }
  writeFileSync(join(fixture, "large.json"), JSON.stringify(generated, null, 2));
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "bash-token-benchmark",
      private: true,
      scripts: { test: "node noisy-test.mjs" },
    }),
  );
  writeFileSync(
    join(fixture, "noisy-test.mjs"),
    `for (let i = 0; i < 1500; i++) console.log(\`PASS test case \${i}: repeated assertion details\`);\nconsole.error("FAIL intentional TOKEN_BENCH_TEST_FAILURE");\nprocess.exit(1);\n`,
  );

  run("git", ["init", "-q"]);
  run("git", ["config", "user.email", "benchmark@example.com"]);
  run("git", ["config", "user.name", "Benchmark"]);
  run("git", ["add", "."]);
  run("git", ["commit", "-qm", "benchmark baseline"]);
  for (let index = 0; index < 40; index++) {
    writeFileSync(join(sourceDir, `untracked-${String(index).padStart(3, "0")}.txt`), `TOKEN_BENCH_UNTRACKED_${index}\n`);
  }
  writeFileSync(
    join(sourceDir, "module-000.ts"),
    `${Array.from({ length: 600 }, (_, index) => `export const changed_${index} = "TOKEN_BENCH_DIFF_${index}";`).join("\n")}\n`,
  );
}

createFixture();

const cases = [
  {
    name: "recursive search",
    raw: ["rg", ["-n", "TOKEN_BENCH_MATCH", "src"]],
    optimized: ["rtk", ["rg", "-n", "TOKEN_BENCH_MATCH", "src"]],
    required: ["TOKEN_BENCH_MATCH", "module-000.ts", "module-079.ts"],
  },
  {
    name: "file discovery",
    raw: ["find", ["src", "-type", "f"]],
    optimized: ["rtk", ["find", "src", "-type", "f"]],
    required: ["module-000.ts", "module-079.ts"],
  },
  {
    name: "directory listing",
    raw: ["ls", ["-la", "src"]],
    optimized: ["rtk", ["ls", "-la", "src"]],
    required: ["module-000.ts", "module-079.ts"],
  },
  {
    name: "git status",
    raw: ["git", ["status", "--short"]],
    optimized: ["rtk", ["git", "status", "--short"]],
    required: ["module-000.ts", "untracked-000.txt"],
  },
  {
    name: "git diff",
    raw: ["git", ["diff", "--", "src/module-000.ts"]],
    optimized: ["rtk", ["git", "diff", "--", "src/module-000.ts"]],
    required: ["module-000.ts", "TOKEN_BENCH_DIFF_599"],
  },
  {
    name: "json response",
    raw: ["curl", ["-sS", `file://${join(fixture, "large.json")}`]],
    optimized: ["rtk", ["curl", "-sS", `file://${join(fixture, "large.json")}`]],
    required: ["property_0000", "property_1199"],
  },
  {
    name: "failing test output",
    raw: ["pnpm", ["test"]],
    optimized: ["rtk", ["pnpm", "test"]],
    required: ["TOKEN_BENCH_TEST_FAILURE"],
  },
];

try {
  const results = [];
  for (const benchmarkCase of cases) {
    const raw = run(...benchmarkCase.raw);
    const optimized = run(...benchmarkCase.optimized);
    const missing = benchmarkCase.required.filter(
      (marker) => !optimized.output.includes(marker),
    );
    const valid =
      !raw.error &&
      !optimized.error &&
      raw.status === optimized.status &&
      missing.length === 0;
    results.push({
      name: benchmarkCase.name,
      valid,
      rawExit: raw.status,
      optimizedExit: optimized.status,
      missing,
      rawTokens: estimatedTokens(raw.output),
      optimizedTokens: estimatedTokens(optimized.output),
      savingsPercent:
        raw.output.length === 0
          ? 0
          : Number(
              (
                (1 - estimatedTokens(optimized.output) / estimatedTokens(raw.output)) *
                100
              ).toFixed(2),
            ),
      rawDurationMs: Number(raw.durationMs.toFixed(1)),
      optimizedDurationMs: Number(optimized.durationMs.toFixed(1)),
    });
  }

  const invalid = results.filter((result) => !result.valid);
  const rawTokens = results.reduce((sum, result) => sum + result.rawTokens, 0);
  const optimizedTokens = results.reduce(
    (sum, result) => sum + result.optimizedTokens,
    0,
  );
  const report = {
    corpusCases: results.length,
    validCases: results.length - invalid.length,
    rawTokens,
    optimizedTokens,
    savingsPercent: Number(((1 - optimizedTokens / rawTokens) * 100).toFixed(2)),
    estimator: "ceil(UTF-8 bytes / 4)",
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  console.log(`BASH_OUTPUT_TOKENS=${optimizedTokens}`);
  if (invalid.length > 0) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
