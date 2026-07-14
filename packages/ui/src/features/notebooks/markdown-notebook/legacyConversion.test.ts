// Ported from posthog `frontend/src/scenes/notebooks/Notebook/markdownNotebookV2.test.ts`
// — the `convertNotebookContentToMarkdown` cases only. Upstream expectations are
// the spec; keep them verbatim so behavior stays in lockstep.

import { buildMarkdownNotebookContent } from "@posthog/core/notebooks/notebookContent";
import { describe, expect, it } from "vitest";

import {
  convertNotebookContentToMarkdown,
  type RichContentJson,
} from "./legacyConversion";
import { parseMarkdownNotebook } from "./markdown";

describe("legacyConversion", () => {
  it("returns the stored markdown unchanged for markdown notebook content", () => {
    const content = buildMarkdownNotebookContent(
      "# Activation\n\nAlready markdown",
      "node-1",
    );

    expect(convertNotebookContentToMarkdown(content)).toEqual(
      "# Activation\n\nAlready markdown",
    );
  });

  it("converts common legacy notebook nodes to markdown", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Activation" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " paragraph." },
          ],
        },
        {
          type: "ph-query",
          attrs: {
            query: {
              kind: "InsightVizNode",
              source: { kind: "FunnelsQuery", series: [] },
            },
          },
        },
        {
          type: "ph-recording",
          attrs: {
            id: "018b4205-f670-7fa8-928a-040abaaf596d",
            title: "Session replay",
          },
        },
        {
          type: "ph-image",
          attrs: {
            src: "https://res.cloudinary.com/demo/image/upload/posthog.png",
            alt: "PostHog engineering",
          },
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(`# Activation

A **bold** paragraph.

<Query hideFilters query={{"kind":"InsightVizNode","source":{"kind":"FunnelsQuery","series":[]}}} />

<Recording hideFilters id="018b4205-f670-7fa8-928a-040abaaf596d" title="Session replay" />

![PostHog engineering](https://res.cloudinary.com/demo/image/upload/posthog.png)`);
  });

  it("converts inline marks (italic, code, link, strike) in headings and paragraphs", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "text", text: "Slanted", marks: [{ type: "italic" }] },
            { type: "text", text: " heading" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "code_span", marks: [{ type: "code" }] },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "a link",
              marks: [{ type: "link", attrs: { href: "https://posthog.com" } }],
            },
            { type: "text", text: " and " },
            { type: "text", text: "gone", marks: [{ type: "strike" }] },
          ],
        },
      ],
    };

    expect(
      convertNotebookContentToMarkdown(content),
    ).toEqual(`## *Slanted* heading

\`code_span\` and [a link](https://posthog.com) and ~~gone~~`);
  });

  it("preserves explicitly open legacy widget filters", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "ph-query",
          attrs: {
            query: {
              kind: "SavedInsightNode",
              shortId: "open",
            },
            edit: true,
          },
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(
      '<Query query={{"kind":"SavedInsightNode","shortId":"open"}} />',
    );
  });

  it("converts raw legacy content arrays without dropping top-level text nodes", () => {
    const content: RichContentJson[] = [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Array notebook" }],
      },
      {
        type: "text",
        text: "Loose top-level text",
        marks: [{ type: "italic" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Wrapped paragraph" }],
      },
    ];

    expect(convertNotebookContentToMarkdown(content)).toEqual(`# Array notebook

*Loose top-level text*

Wrapped paragraph`);
  });

  it("converts string content without dropping data", () => {
    const legacyDocString = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "JSON string notebook" }],
        },
      ],
    });

    expect(convertNotebookContentToMarkdown(legacyDocString)).toEqual(
      "# JSON string notebook",
    );
    expect(
      convertNotebookContentToMarkdown("# Already Markdown\n\nPlain body"),
    ).toEqual("# Already Markdown\n\nPlain body");
    expect(convertNotebookContentToMarkdown("Plain text body")).toEqual(
      "Plain text body",
    );
  });

  it("converts legacy ph-insight nodes to saved insight query tags", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        { type: "ph-insight", attrs: { id: "abc123" } },
        { type: "ph-insight", attrs: { id: 123, short_id: "def456" } },
      ],
    };

    expect(
      convertNotebookContentToMarkdown(content),
    ).toEqual(`<Query hideFilters query={{"kind":"SavedInsightNode","shortId":"abc123"}} />

<Query hideFilters query={{"kind":"SavedInsightNode","shortId":"def456"}} />`);
  });

  it("converts remaining legacy production node shapes without unknown nodes", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        { type: "ph-text", attrs: { body: "# Markdown body" } },
        { type: "ph-dashboard", attrs: { id: 123 } },
        {
          type: "query",
          attrs: {
            query: {
              kind: "HogQLQuery",
              query: "select event from events limit 1",
            },
          },
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(`# Markdown body

Dashboard 123

<Query hideFilters query={{"kind":"DataVisualizationNode","source":{"kind":"HogQLQuery","query":"select event from events limit 1"}}} />`);
  });

  it("keeps a query attr whose object carries nested undefined optional fields", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "ph-query",
          attrs: {
            query: {
              kind: "InsightVizNode",
              source: {
                kind: "TrendsQuery",
                series: [
                  { kind: "EventsNode", event: "$pageview", math: undefined },
                ],
                properties: undefined,
              },
              full: undefined,
            },
            isDefaultFilterApplied: false,
          },
        },
      ],
    };

    // Nested undefined must be stripped, not cause the whole query prop to be dropped.
    expect(convertNotebookContentToMarkdown(content)).toEqual(
      '<Query hideFilters query={{"kind":"InsightVizNode","source":{"kind":"TrendsQuery","series":[{"kind":"EventsNode","event":"$pageview"}]}}} isDefaultFilterApplied={false} />',
    );
  });

  it("serializes a json-string query attr as an expression that parses back to an object", () => {
    // Persisted v1 nodes can carry `query` as a JSON string (NodeWrapper round-trips attrs as
    // JSON). Serializing it verbatim emits query="..." which parses back as a string, rendering
    // an empty Query node.
    const queryObject = {
      kind: "DataVisualizationNode",
      source: {
        kind: "HogQLQuery",
        query: "select event, count() from events group by event",
      },
      display: "ActionsTable",
    };
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "ph-query",
          attrs: { query: JSON.stringify(queryObject), nodeId: "cc41998d" },
        },
      ],
    };

    const markdown = convertNotebookContentToMarkdown(content);
    expect(markdown).toContain('query={{"kind":"DataVisualizationNode"');
    expect(markdown).not.toContain('query="');

    const parsedNode = parseMarkdownNotebook(markdown).nodes.find(
      (node) => node.type === "component",
    );
    expect(
      parsedNode?.type === "component" ? parsedNode.props.query : null,
    ).toEqual(queryObject);
  });

  it("converts legacy task lists to checkbox list markdown", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Done thing" }],
                },
              ],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Open thing" }],
                },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Nested open" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(`- [x] Done thing
- [ ] Open thing
  - [ ] Nested open`);
  });

  it("converts nested bullet and ordered lists", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "parent" }],
                },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "child step" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = convertNotebookContentToMarkdown(content);
    expect(markdown).toEqual(`- parent
  1. child step`);
    expect(parseMarkdownNotebook(markdown).errors).toEqual([]);
  });

  it("keeps extra block content from legacy list items instead of dropping it", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first para" }],
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "second para" }],
                },
                {
                  type: "codeBlock",
                  attrs: { language: "sql" },
                  content: [{ type: "text", text: "select 1" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "next item" }],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(`- first para

second para

\`\`\`sql
select 1
\`\`\`

- next item`);
  });

  it("converts horizontal rules and strikethrough marks", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "struck", marks: [{ type: "strike" }] },
          ],
        },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(`~~struck~~

---

after`);
  });

  it("flattens hard breaks inside table cells so rows stay on one line", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "H1" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "line1" },
                        { type: "hardBreak" },
                        { type: "text", text: "line2" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(`| H1 |
| --- |
| line1 line2 |`);
  });

  it("converts legacy markdown ast alias nodes without losing structure", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
              ],
            },
          ],
        },
        {
          type: "ordered_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "step" }],
                },
              ],
            },
          ],
        },
        {
          type: "code_block",
          attrs: { language: "sql" },
          content: [
            { type: "text", text: "select 1" },
            { type: "hardBreak" },
            { type: "text", text: "select 2" },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "table_row",
              content: [
                {
                  type: "table_header",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Metric" }],
                    },
                  ],
                },
                {
                  type: "table_cell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Value" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "callout",
          attrs: { emoji: "!" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Heads", marks: [{ type: "strong" }] },
                { type: "text", text: " and " },
                { type: "text", text: "note", marks: [{ type: "em" }] },
              ],
            },
          ],
        },
        {
          type: "ph-link",
          attrs: { href: "https://app.posthog.com/cohorts/37958" },
        },
      ],
    };

    const markdown = convertNotebookContentToMarkdown(content);

    expect(markdown).toContain("- first");
    expect(markdown).toContain("1. step");
    expect(markdown).toContain("```sql\nselect 1\nselect 2\n```");
    expect(markdown).toContain("| Metric | Value |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("> ! **Heads** and *note*");
    expect(markdown).toContain(
      "[https://app.posthog.com/cohorts/37958](https://app.posthog.com/cohorts/37958)",
    );
    expect(parseMarkdownNotebook(markdown).errors).toEqual([]);
  });

  it("produces markdown that parses without errors in the markdown notebook model", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Mixed" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "task" }],
                },
              ],
            },
          ],
        },
        { type: "horizontalRule" },
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "quote" }] },
          ],
        },
      ],
    };

    const parsed = parseMarkdownNotebook(
      convertNotebookContentToMarkdown(content),
    );
    expect(parsed.errors).toEqual([]);
    // The legacy horizontal rule round-trips into the markdown notebook divider component
    expect(parsed.nodes.map((node) => node.type)).toEqual([
      "heading",
      "list",
      "component",
      "blockquote",
    ]);
  });

  it("splits embedded cards out of blockquotes while keeping headings quoted", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted context" }],
            },
            {
              type: "ph-query",
              attrs: {
                query: { kind: "SavedInsightNode", shortId: "abc123" },
                hideFilters: true,
              },
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "heading",
                  attrs: { level: 2 },
                  content: [{ type: "text", text: "Where to improve" }],
                },
                {
                  type: "ph-python",
                  attrs: { code: "print(1)", hideFilters: true },
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = convertNotebookContentToMarkdown(content);

    expect(markdown).toContain("> Quoted context");
    expect(markdown).toContain("\n\n<Query ");
    expect(markdown).toContain("> ## Where to improve");
    expect(markdown).toContain("\n\n<Python ");
    expect(markdown).not.toContain("> <");

    const parsed = parseMarkdownNotebook(markdown);
    expect(parsed.errors).toEqual([]);
    expect(
      parsed.nodes.flatMap((node) =>
        node.type === "component" ? [node.tagName] : [],
      ),
    ).toEqual(["Query", "Python"]);
    const quotedHeading = parsed.nodes.find((node) => node.type === "heading");
    expect(quotedHeading?.type === "heading" && quotedHeading.blockquote).toBe(
      true,
    );
  });

  it("splits embedded cards out of callouts while keeping the emoji and text quoted", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { emoji: "!" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Watch this" }],
            },
            {
              type: "ph-query",
              attrs: {
                query: { kind: "SavedInsightNode", shortId: "abc123" },
                hideFilters: true,
              },
            },
          ],
        },
      ],
    };

    const markdown = convertNotebookContentToMarkdown(content);

    expect(markdown).toContain("> ! Watch this");
    expect(markdown).toContain("\n\n<Query ");
    expect(markdown).not.toContain("> <");
    expect(parseMarkdownNotebook(markdown).errors).toEqual([]);
  });

  it("preserves unknown leaf nodes as UnknownNode components", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [{ type: "ph-whatever", attrs: { id: 7, label: "mystery" } }],
    };

    const markdown = convertNotebookContentToMarkdown(content);
    expect(markdown).toEqual(
      '<UnknownNode nodeType="ph-whatever" id={7} label="mystery" />',
    );

    const parsed = parseMarkdownNotebook(markdown);
    expect(parsed.errors).toEqual([]);
    const node = parsed.nodes[0];
    expect(node?.type === "component" && node.tagName).toEqual("UnknownNode");
    expect(node?.type === "component" ? node.props : null).toEqual({
      id: 7,
      label: "mystery",
      nodeType: "ph-whatever",
    });
  });

  it("converts v1 comment marks to ref highlights with comment threads", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Numbers " },
            {
              type: "text",
              text: "look off",
              marks: [{ type: "comment", attrs: { id: "mark-1" } }],
            },
            { type: "text", text: " here" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Unrelated" }] },
      ],
    };

    const markdown = convertNotebookContentToMarkdown(content, {
      commentRepliesByMarkId: {
        "mark-1": [
          {
            id: "c1",
            author: "Ann",
            text: "Why is this lower?",
            at: "2026-01-01T00:00:00Z",
          },
        ],
      },
    });

    expect(markdown).toEqual(
      [
        '<Comment ref="mark-1" replies={[{"id":"c1","author":"Ann","text":"Why is this lower?","at":"2026-01-01T00:00:00Z"}]} />',
        "",
        'Numbers <ref id="mark-1">look off</ref> here',
        "",
        "Unrelated",
      ].join("\n"),
    );
    expect(parseMarkdownNotebook(markdown).errors).toEqual([]);
  });

  it("emits an empty comment thread when no replies are provided for a mark", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "annotated",
              marks: [{ type: "comment", attrs: { id: "m1" } }],
            },
          ],
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toEqual(
      '<Comment ref="m1" replies={[]} />\n\n<ref id="m1">annotated</ref>',
    );
  });

  it("wraps the ref outside other formatting marks", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bolded",
              marks: [
                { type: "bold" },
                { type: "comment", attrs: { id: "m1" } },
              ],
            },
          ],
        },
      ],
    };

    expect(convertNotebookContentToMarkdown(content)).toContain(
      '<ref id="m1">**bolded**</ref>',
    );
  });

  it("converts mentions to mention tags preserving the member id", () => {
    const content: RichContentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ping " },
            { type: "ph-mention", attrs: { id: 5 } },
          ],
        },
      ],
    };

    expect(
      convertNotebookContentToMarkdown(content, {
        getMentionLabel: () => "@Marius",
      }),
    ).toEqual('Ping <mention id="5">@Marius</mention>');
    expect(convertNotebookContentToMarkdown(content)).toEqual(
      'Ping <mention id="5">@member</mention>',
    );
  });
});
