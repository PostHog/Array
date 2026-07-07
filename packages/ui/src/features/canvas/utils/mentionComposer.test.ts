import type { UserBasic } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import {
  applyMention,
  filterMentionCandidates,
  findMentionQuery,
} from "./mentionComposer";

function member(overrides: Partial<UserBasic> & { email: string }): UserBasic {
  return {
    id: 1,
    uuid: overrides.email,
    first_name: "",
    last_name: "",
    ...overrides,
  };
}

const ann = member({
  email: "ann@posthog.com",
  first_name: "Ann",
  last_name: "Lee",
});
const bob = member({
  email: "bob@posthog.com",
  first_name: "Bob",
  last_name: "Stone",
});
const raquel = member({
  email: "raquel@posthog.com",
  first_name: "Raquel",
  last_name: "Smith",
});
const members = [ann, bob, raquel];

describe("findMentionQuery", () => {
  it.each([
    ["at text start", "@ra", 3, { start: 0, query: "ra" }],
    ["after whitespace", "hey @ra", 7, { start: 4, query: "ra" }],
    ["empty query right after @", "hey @", 5, { start: 4, query: "" }],
    [
      "query with a space",
      "hey @raquel sm",
      14,
      { start: 4, query: "raquel sm" },
    ],
    ["mid-word @ (emails)", "mail me@work", 12, null],
    ["query opening with [ (inserted token)", "@[Ann](a) x", 9, null],
    ["query starting with a space", "hey @ home", 10, null],
    ["query spanning a newline", "hey @ra\nnew", 11, null],
    ["no @ before caret", "hello", 5, null],
  ])("%s", (_label, text, caret, expected) => {
    expect(findMentionQuery(text, caret)).toEqual(expected);
  });

  it("only considers text before the caret", () => {
    expect(findMentionQuery("@raquel", 3)).toEqual({ start: 0, query: "ra" });
  });
});

describe("filterMentionCandidates", () => {
  it("returns everyone for an empty query", () => {
    expect(filterMentionCandidates(members, "")).toEqual([ann, bob, raquel]);
  });

  it("ranks name prefix over word prefix over email over substring", () => {
    const smithers = member({
      email: "s@posthog.com",
      first_name: "Smi",
      last_name: "Thers",
    });
    expect(filterMentionCandidates([...members, smithers], "sm")).toEqual([
      smithers, // name prefix
      raquel, // last-name word prefix
    ]);
  });

  it("matches by email", () => {
    expect(filterMentionCandidates(members, "bob@")).toEqual([bob]);
  });

  it("is case-insensitive and respects the limit", () => {
    expect(filterMentionCandidates(members, "RAQ")).toEqual([raquel]);
    expect(filterMentionCandidates(members, "", 2)).toHaveLength(2);
  });

  it("returns empty when nothing matches", () => {
    expect(filterMentionCandidates(members, "zzz")).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces the active query, reusing the existing following space", () => {
    const text = "hey @raq can you look";
    const active = { start: 4, query: "raq" };
    const result = applyMention(text, active, 8, raquel);
    expect(result.text).toBe(
      "hey @[Raquel Smith](raquel@posthog.com) can you look",
    );
    expect(result.caret).toBe(
      "hey @[Raquel Smith](raquel@posthog.com) ".length,
    );
  });

  it("consumes the rest of the @word when the caret moved backward", () => {
    // "hey @raq" with the caret between "ra" and "q": the trailing "q" is
    // still query text and must not leak into the message.
    const result = applyMention(
      "hey @raq",
      { start: 4, query: "ra" },
      7,
      raquel,
    );
    expect(result.text).toBe("hey @[Raquel Smith](raquel@posthog.com) ");
    expect(result.caret).toBe(result.text.length);
  });

  it("does not consume text beyond the @word", () => {
    const result = applyMention(
      "@ra world",
      { start: 0, query: "ra" },
      3,
      raquel,
    );
    expect(result.text).toBe("@[Raquel Smith](raquel@posthog.com) world");
  });

  it("works at the end of the text", () => {
    const result = applyMention("@", { start: 0, query: "" }, 1, ann);
    expect(result.text).toBe("@[Ann Lee](ann@posthog.com) ");
    expect(result.caret).toBe(result.text.length);
  });
});
