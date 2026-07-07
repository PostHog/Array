import { describe, expect, it } from "vitest";
import {
  extractMentionEmails,
  formatMention,
  mentionsToPlainText,
  mentionsUser,
  splitMentionSegments,
} from "./mentions";

describe("formatMention", () => {
  it("serializes name and email into a token", () => {
    expect(formatMention("Raquel Smith", "raquel@posthog.com")).toBe(
      "@[Raquel Smith](raquel@posthog.com)",
    );
  });

  it.each([
    ["strips brackets from names", "A [b] c", "a@x.com", "@[A  b  c](a@x.com)"],
    [
      "falls back to the email local part",
      "[]",
      "ann@x.com",
      "@[ann](ann@x.com)",
    ],
  ])("%s", (_label, name, email, expected) => {
    expect(formatMention(name, email)).toBe(expected);
  });

  it("round-trips through the parser", () => {
    const token = formatMention("Raquel Smith", "raquel@posthog.com");
    const segments = splitMentionSegments(`hey ${token}!`);
    expect(segments).toEqual([
      { type: "text", text: "hey " },
      {
        type: "mention",
        text: token,
        name: "Raquel Smith",
        email: "raquel@posthog.com",
      },
      { type: "text", text: "!" },
    ]);
  });
});

describe("splitMentionSegments", () => {
  it("returns a single text segment when there are no mentions", () => {
    expect(splitMentionSegments("no mentions here")).toEqual([
      { type: "text", text: "no mentions here" },
    ]);
  });

  it("handles adjacent and repeated mentions", () => {
    const content = "@[A](a@x.com)@[B](b@x.com) and @[A](a@x.com)";
    const segments = splitMentionSegments(content);
    expect(segments.map((s) => s.type)).toEqual([
      "mention",
      "mention",
      "text",
      "mention",
    ]);
  });

  it("ignores markdown links and bare @ text", () => {
    const content = "see [docs](https://x.com) and email me @ home";
    expect(splitMentionSegments(content)).toEqual([
      { type: "text", text: content },
    ]);
  });

  it("ignores malformed tokens", () => {
    for (const content of [
      "@[no email]()",
      "@[unclosed](a@x.com",
      "@[](a@x.com)",
      "@[spaced email](a b@x.com)",
    ]) {
      expect(
        splitMentionSegments(content).every((s) => s.type === "text"),
      ).toBe(true);
    }
  });
});

describe("extractMentionEmails / mentionsUser", () => {
  const content = "cc @[Ann](Ann@PostHog.com) and @[Bob](bob@posthog.com)";

  it("lowercases and dedupes emails", () => {
    expect(
      extractMentionEmails(`${content} again @[Ann](ann@posthog.com)`),
    ).toEqual(["ann@posthog.com", "bob@posthog.com"]);
  });

  it("matches the mentioned user case-insensitively", () => {
    expect(mentionsUser(content, "ann@posthog.com")).toBe(true);
    expect(mentionsUser(content, "ANN@posthog.com")).toBe(true);
    expect(mentionsUser(content, "carol@posthog.com")).toBe(false);
    expect(mentionsUser(content, null)).toBe(false);
  });
});

describe("mentionsToPlainText", () => {
  it("flattens tokens to @Name", () => {
    expect(mentionsToPlainText("hi @[Ann Lee](ann@x.com), ship it")).toBe(
      "hi @Ann Lee, ship it",
    );
  });
});
