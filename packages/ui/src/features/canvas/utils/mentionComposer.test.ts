import type { UserBasic } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { filterMentionCandidates } from "./mentionComposer";

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
