import { beforeEach, describe, expect, it } from "vitest";
import {
  ANNOTATION_OVERLAY_ID,
  buildAnnotationShimScript,
  buildTextIndex,
  cssPathFor,
  labelFor,
  resolveTextQuote,
  textQuoteFromSelection,
} from "./annotationShim";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildTextIndex", () => {
  it("collapses whitespace and skips scripts, styles, and the overlay", () => {
    document.body.innerHTML = [
      "<p>Hello \n\t  world</p>",
      "<script>var hidden = 1;</script>",
      "<style>.x { color: red }</style>",
      `<div id="${ANNOTATION_OVERLAY_ID}">pin text</div>`,
      "<p> again </p>",
    ].join("");
    const index = buildTextIndex(document, ANNOTATION_OVERLAY_ID);
    expect(index.text).toBe("Hello world again");
    expect(index.charNode.length).toBe(index.text.length);
    expect(index.charOff.length).toBe(index.text.length);
  });
});

describe("resolveTextQuote", () => {
  it("resolves a quote spanning multiple nodes to the exact range", () => {
    document.body.innerHTML =
      "<p>Revenue <strong>grew 18%</strong> quarter over quarter.</p>";
    const index = buildTextIndex(document, ANNOTATION_OVERLAY_ID);
    const range = resolveTextQuote(
      document,
      { type: "text", quote: "grew 18% quarter", prefix: "", suffix: "" },
      index,
    );
    expect(range).not.toBeNull();
    expect(range?.toString().replace(/\s+/g, " ")).toBe("grew 18% quarter");
  });

  it("disambiguates repeated quotes by prefix/suffix context", () => {
    document.body.innerHTML =
      "<p>alpha target beta</p><p>gamma target delta</p>";
    const index = buildTextIndex(document, ANNOTATION_OVERLAY_ID);
    const range = resolveTextQuote(
      document,
      { type: "text", quote: "target", prefix: "gamma ", suffix: " delta" },
      index,
    );
    expect(range).not.toBeNull();
    expect(range?.startContainer.parentElement?.textContent).toBe(
      "gamma target delta",
    );
  });

  it("returns null when the quote no longer exists", () => {
    document.body.innerHTML = "<p>nothing to see</p>";
    const index = buildTextIndex(document, ANNOTATION_OVERLAY_ID);
    expect(
      resolveTextQuote(
        document,
        { type: "text", quote: "vanished", prefix: "", suffix: "" },
        index,
      ),
    ).toBeNull();
  });
});

describe("textQuoteFromSelection", () => {
  it("captures the selected text with normalized context", () => {
    document.body.innerHTML =
      "<p>Headline: revenue grew 18% quarter over quarter, driven by expansion.</p>";
    const textNode = document.querySelector("p")?.firstChild as Text;
    const start = textNode.data.indexOf("grew 18%");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "grew 18%".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const anchor = textQuoteFromSelection(document, 32, 1000);
    expect(anchor).toMatchObject({ type: "text", quote: "grew 18%" });
    expect(anchor?.prefix.endsWith("revenue ")).toBe(true);
    expect(anchor?.suffix.startsWith(" quarter over")).toBe(true);
  });

  it("returns null for collapsed and oversized selections", () => {
    document.body.innerHTML = "<p>short text</p>";
    window.getSelection()?.removeAllRanges();
    expect(textQuoteFromSelection(document, 32, 1000)).toBeNull();

    const textNode = document.querySelector("p")?.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10);
    window.getSelection()?.addRange(range);
    expect(textQuoteFromSelection(document, 32, 3)).toBeNull();
  });
});

describe("cssPathFor", () => {
  it("shortcuts to a unique id", () => {
    document.body.innerHTML = '<section id="pricing"><p>hi</p></section>';
    const el = document.querySelector("p") as Element;
    const section = document.getElementById("pricing") as Element;
    expect(cssPathFor(section, document)).toBe("#pricing");
    // The nested element roots its path at the id'd ancestor.
    expect(cssPathFor(el, document)).toBe("#pricing > p:nth-of-type(1)");
  });

  it("builds an nth-of-type path that round-trips through querySelector", () => {
    document.body.innerHTML =
      "<table><tbody><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></tbody></table>";
    const target = document.querySelectorAll("tr")[2] as Element;
    const selector = cssPathFor(target, document);
    expect(document.querySelector(selector)).toBe(target);
  });
});

describe("labelFor", () => {
  it("combines the tag with a trimmed text snippet", () => {
    document.body.innerHTML =
      "<table><tbody><tr><td>  Enterprise   $1.2M   +8% and lots more text that keeps going on</td></tr></tbody></table>";
    const label = labelFor(document.querySelector("tr") as Element);
    expect(label.startsWith("tr — Enterprise $1.2M +8%")).toBe(true);
    expect(label.length).toBeLessThanOrEqual("tr — ".length + 40);
  });

  it("falls back to the bare tag for empty elements", () => {
    document.body.innerHTML = "<hr>";
    expect(labelFor(document.querySelector("hr") as Element)).toBe("hr");
  });
});

describe("buildAnnotationShimScript", () => {
  it("produces a self-contained script bound to the protocol channel", () => {
    const script = buildAnnotationShimScript();
    expect(script).toContain('"posthog-html-canvas"');
    expect(script).toContain(ANNOTATION_OVERLAY_ID);
    // Everything must be serialized in — no module imports can survive.
    expect(script).not.toContain("import ");
    expect(script).not.toContain("require(");
  });
});
