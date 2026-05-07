import { describe, expect, it } from "vitest";
import {
  type ExtractCreatedPrUrlInput,
  extractCreatedPrUrl,
} from "./pr-url-detector";

const PR_URL = "https://github.com/PostHog/posthog/pull/12345";

interface Case {
  name: string;
  input: ExtractCreatedPrUrlInput;
  expected: string | null;
}

const cases: Case[] = [
  {
    name: "returns the URL when gh pr create produced it (string toolResponse)",
    input: {
      toolName: "Bash",
      bashCommand: 'gh pr create --title "x" --body "y"',
      toolResponse: `${PR_URL}\n`,
    },
    expected: PR_URL,
  },
  {
    name: "returns the URL when gh pr create produced it (object toolResponse)",
    input: {
      toolName: "Bash",
      bashCommand: "gh pr create --fill",
      toolResponse: { stdout: `${PR_URL}\n`, stderr: "" },
    },
    expected: PR_URL,
  },
  {
    name: "ignores PR URLs from gh pr view",
    input: {
      toolName: "Bash",
      bashCommand: `gh pr view ${PR_URL}`,
      toolResponse: { stdout: PR_URL },
    },
    expected: null,
  },
  {
    name: "ignores PR URLs from gh search prs",
    input: {
      toolName: "Bash",
      bashCommand: 'gh search prs "fix login"',
      toolResponse: PR_URL,
    },
    expected: null,
  },
  {
    name: "ignores PR URLs from gh pr list",
    input: {
      toolName: "Bash",
      bashCommand: "gh pr list --json url",
      toolResponse: PR_URL,
    },
    expected: null,
  },
  {
    name: "returns null when bashCommand is missing",
    input: {
      toolName: "Bash",
      bashCommand: undefined,
      toolResponse: PR_URL,
    },
    expected: null,
  },
  {
    name: "returns null for non-Bash tools",
    input: {
      toolName: "Edit",
      bashCommand: "gh pr create",
      toolResponse: PR_URL,
    },
    expected: null,
  },
  {
    name: "accepts the lowercase 'bash' tool variant",
    input: {
      toolName: "bash",
      bashCommand: "gh pr create",
      toolResponse: PR_URL,
    },
    expected: PR_URL,
  },
  {
    name: "returns null when output has no PR URL",
    input: {
      toolName: "Bash",
      bashCommand: "gh pr create",
      toolResponse: "no pr was created",
    },
    expected: null,
  },
  {
    name: "finds the URL in the content array when toolResponse is empty",
    input: {
      toolName: "Bash",
      bashCommand: "gh pr create --fill",
      toolResponse: undefined,
      content: [{ type: "text", text: `Created: ${PR_URL}` }],
    },
    expected: PR_URL,
  },
  {
    name: "handles output field on object toolResponse",
    input: {
      toolName: "Bash",
      bashCommand: "gh pr create",
      toolResponse: { output: PR_URL },
    },
    expected: PR_URL,
  },
  {
    name: "matches gh pr create even with a chained command",
    input: {
      toolName: "Bash",
      bashCommand: "git push -u origin feat/x && gh pr create --fill",
      toolResponse: { stdout: PR_URL },
    },
    expected: PR_URL,
  },
  {
    name: "does not match a fake command containing 'pr create' as text",
    input: {
      toolName: "Bash",
      bashCommand: "echo 'i should pr create later'",
      toolResponse: PR_URL,
    },
    expected: null,
  },
];

describe("extractCreatedPrUrl", () => {
  it.each(cases)("$name", ({ input, expected }) => {
    expect(extractCreatedPrUrl(input)).toBe(expected);
  });
});
