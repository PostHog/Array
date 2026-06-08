import { describe, expect, it } from "vitest";
import { stripMarkerTags } from "./sdk-to-acp";

describe("stripMarkerTags", () => {
  it("strips a single marker and keeps surrounding prose", () => {
    expect(
      stripMarkerTags("before<command-name>/model</command-name>after"),
    ).toBe("beforeafter");
  });

  it("strips multiple different markers in one pass", () => {
    const input =
      "a<command-args>x</command-args>b<local-command-stdout>out</local-command-stdout>c";
    expect(stripMarkerTags(input)).toBe("abc");
  });

  it("leaves text without markers unchanged", () => {
    expect(stripMarkerTags("")).toBe("");
    expect(stripMarkerTags("plain prose with < and > but no tags")).toBe(
      "plain prose with < and > but no tags",
    );
  });

  it("passes an unclosed opener through verbatim (dead-set path)", () => {
    const input = "<command-name>no closing tag, prose continues";
    expect(stripMarkerTags(input)).toBe(input);
  });

  it("does not treat an orphan closing tag as an opener", () => {
    expect(
      stripMarkerTags("</command-name>text<command-name>real</command-name>"),
    ).toBe("</command-name>text");
  });

  it("matches the nearest closing tag for a repeated opener", () => {
    expect(
      stripMarkerTags(
        "<command-name>outer<command-name>inner</command-name>trailing",
      ),
    ).toBe("trailing");
  });

  it("stays linear on pathological unclosed input", () => {
    const input = `${"<command-name>".repeat(20000)}tail`;
    expect(stripMarkerTags(input)).toBe(input);
  });
});
