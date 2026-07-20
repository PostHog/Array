import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GITHUB_REF_URL_ATTR } from "../../../editor/components/GithubRefChip";
import { ChatMarkdown } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("does not load remote markdown images", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown content="![internal service](http://127.0.0.1/action)" />,
    );

    expect(html).toContain("Remote image blocked: internal service");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("http://127.0.0.1/action");
  });

  it("renders GitHub PR URLs as ref chips, matching the conversation view", () => {
    const url = "https://github.com/PostHog/posthog/pull/23985";
    const html = renderToStaticMarkup(
      <ChatMarkdown content={`See ${url} for context.`} />,
    );

    expect(html).toContain(GITHUB_REF_URL_ATTR);
    expect(html).toContain(url);
    expect(html).toContain("PostHog/posthog#23985");
  });

  it("leaves non-GitHub links as plain anchors", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown content="[docs](https://example.com/docs)" />,
    );

    expect(html).not.toContain(GITHUB_REF_URL_ATTR);
    expect(html).toContain('href="https://example.com/docs"');
  });
});
