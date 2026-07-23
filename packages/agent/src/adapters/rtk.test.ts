import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Logger } from "../utils/logger";
import { createRtkRewriteHook } from "./claude/session/rtk";
import { detectRtkBinary, resolveRtkPrefix, rewriteBashForRtk } from "./rtk";

describe("rewriteBashForRtk", () => {
  test.each([
    ["pnpm test", "rtk test pnpm test"],
    [
      "pnpm --filter @acme/app test --runInBand",
      "rtk test pnpm --filter @acme/app test --runInBand",
    ],
    ["CI=1 pnpm test", "CI=1 rtk test pnpm test"],
    [
      'CI=1 MODE="full suite" pnpm test',
      'CI=1 MODE="full suite" rtk test pnpm test',
    ],
    ["npm test", "rtk test npm test"],
    ["npm run test -- --watch=false", "rtk test npm run test -- --watch=false"],
    [
      "npm --workspace @acme/app test",
      "rtk test npm --workspace @acme/app test",
    ],
    ["python -m pytest -q", "rtk test python -m pytest -q"],
    ["python3 -m unittest tests", "rtk test python3 -m unittest tests"],
    ["pytest tests/unit", "rtk test pytest tests/unit"],
    ["uv run pytest", "rtk test uv run pytest"],
    ["poetry run pytest", "rtk test poetry run pytest"],
  ])("rewrites the dedicated test mode for %j", (input, expected) => {
    expect(rewriteBashForRtk(input, "rtk")).toBe(expected);
  });

  test.each([
    ["git status"],
    ["git status --porcelain -z"],
    ["git log --oneline -10"],
    ["ls -la"],
    ["ls -1A"],
    ["rg -n foo src"],
    ["rg -n --null foo src"],
    ["rg --json -n foo src"],
    ["npm test -- --json"],
    ["yarn test --reporter=json"],
    ["bun test --reporter junit"],
    ["yarn test"],
    ["bun test"],
    ["cargo test --workspace"],
    ["pytest --junitxml=report.xml"],
    ["cargo test --message-format=json"],
    ["go test -json ./..."],
    ["dotnet test --logger trx"],
    ["go test ./..."],
    ["dotnet test"],
    ["mvn test"],
    ["./gradlew test"],
    ["bundle exec rspec"],
    ["rake test"],
    ["mix test"],
    ["swift test"],
    ["zig test src/main.zig"],
    ["./vendor/bin/phpunit"],
    ["deno test"],
    ["npx tsc --noEmit"],
    ["docker ps -a"],
    ["kubectl get pods -o yaml"],
    ["aws s3api list-buckets --output yaml"],
    ["psql -c 'select * from events'"],
    ["pip install -r requirements.txt"],
    ["gh api /repos/acme/app"],
    ["find . -type f"],
    ["curl https://example.com/api"],
    ["pnpm test && git status"],
    ["pnpm test || true"],
    ["CI=1 pnpm test | tail -20"],
    ["pnpm test > output.txt"],
    ["pnpm test; git status"],
    ["echo $(pnpm test)"],
    ["1INVALID=value pnpm test"],
    ["CI =1 pnpm test"],
    ["CI=1"],
    ["/usr/bin/pnpm test"],
    [""],
    ["   "],
  ])("leaves %j unchanged", (input) => {
    expect(rewriteBashForRtk(input, "rtk")).toBeNull();
  });

  test("does not double-wrap an RTK command", () => {
    expect(rewriteBashForRtk("rtk test pnpm test", "rtk")).toBeNull();
  });

  test("shell-quotes an RTK path containing spaces", () => {
    expect(rewriteBashForRtk("pnpm test", "/Apps/My Tools/rtk")).toBe(
      "'/Apps/My Tools/rtk' test pnpm test",
    );
  });
});

function writeRtkBinary(
  binary: string,
  version = "0.43.0",
  executable = true,
): void {
  fs.writeFileSync(
    binary,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "rtk ${version}"; exit 0; fi\nexit 0\n`,
  );
  if (executable) fs.chmodSync(binary, 0o755);
}

describe("resolveRtkPrefix", () => {
  let dir: string;
  let binary: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtk-test-"));
    binary = path.join(dir, "rtk");
    writeRtkBinary(binary);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["1", "1"],
    ["true", "true"],
  ])("auto-detects compatible RTK when POSTHOG_RTK is %s", (_label, value) => {
    expect(resolveRtkPrefix({ POSTHOG_RTK: value, PATH: dir })).toBe(binary);
  });

  test.each([
    ["zero", "0"],
    ["false", "false"],
    ["FALSE", "FALSE"],
  ])("honors the %s opt-out", (_label, value) => {
    expect(resolveRtkPrefix({ POSTHOG_RTK: value, PATH: dir })).toBeUndefined();
  });

  test("uses a compatible explicit binary", () => {
    expect(resolveRtkPrefix({ POSTHOG_RTK: binary })).toBe(binary);
  });

  test.each([
    ["missing", "missing", undefined, true],
    ["non-executable", "not-executable", "0.43.0", false],
    ["too old", "old", "0.42.9", true],
    ["wrong identity", "wrong", "not-rtk", true],
  ])("rejects a %s binary", (_label, name, version, executable) => {
    const candidate = path.join(dir, name);
    if (version === "not-rtk") {
      fs.writeFileSync(candidate, "#!/bin/sh\necho 'other 0.43.0'\n");
      fs.chmodSync(candidate, 0o755);
    } else if (version) {
      writeRtkBinary(candidate, version, executable);
    }
    expect(resolveRtkPrefix({ POSTHOG_RTK: candidate })).toBeUndefined();
  });
});

describe("detectRtkBinary", () => {
  let dir: string;
  let binary: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtk-detect-"));
    binary = path.join(dir, "rtk");
    writeRtkBinary(binary);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each([
    ["unset", undefined],
    ["0", "0"],
    ["false", "false"],
    ["1", "1"],
    ["true", "true"],
  ])("finds compatible RTK when POSTHOG_RTK is %s", (_label, value) => {
    expect(detectRtkBinary({ POSTHOG_RTK: value, PATH: dir })).toBe(binary);
  });

  test("reports no binary when RTK is absent", () => {
    expect(detectRtkBinary({ PATH: "/nonexistent" })).toBeUndefined();
  });
});

describe("createRtkRewriteHook", () => {
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  } as unknown as Logger;

  const bashInput = (command: string): HookInput =>
    ({
      session_id: "s",
      transcript_path: "/tmp/t",
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    }) as unknown as HookInput;

  test("rewrites pnpm test through the Claude hook", async () => {
    const hook = createRtkRewriteHook("rtk", logger);
    const result = await hook(bashInput("pnpm test"), "tool-1", {
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "rtk test pnpm test" },
      },
    });
  });

  test("passes generic commands through untouched", async () => {
    const hook = createRtkRewriteHook("rtk", logger);
    const result = await hook(bashInput("git status"), "tool-1", {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ continue: true });
  });

  test("ignores non-Bash tools", async () => {
    const hook = createRtkRewriteHook("rtk", logger);
    const input = {
      session_id: "s",
      transcript_path: "/tmp/t",
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/x" },
    } as unknown as HookInput;
    const result = await hook(input, "tool-1", {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ continue: true });
  });
});
