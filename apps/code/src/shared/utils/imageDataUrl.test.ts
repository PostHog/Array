import { describe, expect, it } from "vitest";
import {
  buildImageDataUrl,
  isAllowedImageMimeType,
  parseImageDataUrl,
} from "./imageDataUrl";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("parseImageDataUrl", () => {
  it("parses a valid PNG data URL", () => {
    const result = parseImageDataUrl(
      `data:image/png;base64,${TINY_PNG_BASE64}`,
    );
    expect(result).toEqual({
      mimeType: "image/png",
      base64: TINY_PNG_BASE64,
    });
  });

  it("accepts other allowed mime types", () => {
    expect(
      parseImageDataUrl(`data:image/jpeg;base64,${TINY_PNG_BASE64}`),
    ).not.toBeNull();
    expect(
      parseImageDataUrl(`data:image/webp;base64,${TINY_PNG_BASE64}`),
    ).not.toBeNull();
    expect(
      parseImageDataUrl(`data:image/gif;base64,${TINY_PNG_BASE64}`),
    ).not.toBeNull();
  });

  it("rejects SVG data URLs to prevent script execution", () => {
    expect(
      parseImageDataUrl(`data:image/svg+xml;base64,${TINY_PNG_BASE64}`),
    ).toBeNull();
  });

  it("rejects non-image mime types", () => {
    expect(
      parseImageDataUrl(`data:text/html;base64,${TINY_PNG_BASE64}`),
    ).toBeNull();
    expect(
      parseImageDataUrl(
        `data:application/javascript;base64,${TINY_PNG_BASE64}`,
      ),
    ).toBeNull();
  });

  it("rejects non-base64 data URLs", () => {
    expect(parseImageDataUrl("data:image/png,not-base64")).toBeNull();
  });

  it("rejects empty or non-data-URL strings", () => {
    expect(parseImageDataUrl("")).toBeNull();
    expect(parseImageDataUrl("hello world")).toBeNull();
    expect(parseImageDataUrl("https://example.com/image.png")).toBeNull();
  });

  it("rejects malformed data URLs", () => {
    expect(parseImageDataUrl("data:")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64,")).toBeNull();
  });

  it("rejects extremely large payloads", () => {
    const huge = "A".repeat(30 * 1024 * 1024);
    expect(parseImageDataUrl(`data:image/png;base64,${huge}`)).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    const result = parseImageDataUrl(
      `\n  data:image/png;base64,${TINY_PNG_BASE64}  \n`,
    );
    expect(result?.mimeType).toBe("image/png");
  });

  it("strips whitespace inside base64 payload", () => {
    const withNewlines = TINY_PNG_BASE64.match(/.{1,40}/g)?.join("\n") ?? "";
    const result = parseImageDataUrl(`data:image/png;base64,${withNewlines}`);
    expect(result?.base64).toBe(TINY_PNG_BASE64);
  });

  it("ignores additional parameters before the base64 marker", () => {
    const result = parseImageDataUrl(
      `data:image/png;charset=utf-8;base64,${TINY_PNG_BASE64}`,
    );
    expect(result?.mimeType).toBe("image/png");
  });

  it("normalises mime type casing", () => {
    const result = parseImageDataUrl(
      `data:IMAGE/PNG;base64,${TINY_PNG_BASE64}`,
    );
    expect(result?.mimeType).toBe("image/png");
  });

  it("handles non-string input safely", () => {
    expect(parseImageDataUrl(null as unknown as string)).toBeNull();
    expect(parseImageDataUrl(undefined as unknown as string)).toBeNull();
    expect(parseImageDataUrl(123 as unknown as string)).toBeNull();
  });
});

describe("isAllowedImageMimeType", () => {
  it("accepts standard image mime types", () => {
    expect(isAllowedImageMimeType("image/png")).toBe(true);
    expect(isAllowedImageMimeType("IMAGE/JPEG")).toBe(true);
  });

  it("rejects SVG and non-image types", () => {
    expect(isAllowedImageMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedImageMimeType("text/html")).toBe(false);
  });
});

describe("buildImageDataUrl", () => {
  it("builds a data URL from parts", () => {
    expect(buildImageDataUrl("image/png", "abc")).toBe(
      "data:image/png;base64,abc",
    );
  });
});
