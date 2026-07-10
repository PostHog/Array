import { getSchema } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { Node as PmNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { contentToDoc, docToContent } from "./MentionComposer";

const schema = getSchema([StarterKit, Mention]);

function roundTrip(content: string): string {
  return docToContent(PmNode.fromJSON(schema, contentToDoc(content)));
}

describe("contentToDoc / docToContent", () => {
  it.each([
    ["plain text", "hello there"],
    ["empty content", ""],
    ["mention token", "hey @[Raquel Smith](raquel@posthog.com) hi"],
    [
      "multiple mentions",
      "@[Ann Lee](ann@posthog.com) @[Bob Stone](bob@posthog.com)",
    ],
    ["multi-line", "first\nsecond\n\nfourth"],
    [
      "mention across lines",
      "cc @[Ann Lee](ann@posthog.com)\nthanks",
    ],
  ])("round-trips %s", (_label, content) => {
    expect(roundTrip(content)).toBe(content);
  });

  it("maps mention tokens to mention nodes with email as id", () => {
    const doc = contentToDoc("hi @[Ann Lee](ann@posthog.com)");
    expect(doc.content?.[0]?.content).toEqual([
      { type: "text", text: "hi " },
      {
        type: "mention",
        attrs: { id: "ann@posthog.com", label: "Ann Lee" },
      },
    ]);
  });

  it("serializes hard breaks as newlines", () => {
    const doc = PmNode.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "one" },
            { type: "hardBreak" },
            { type: "text", text: "two" },
          ],
        },
      ],
    });
    expect(docToContent(doc)).toBe("one\ntwo");
  });
});
