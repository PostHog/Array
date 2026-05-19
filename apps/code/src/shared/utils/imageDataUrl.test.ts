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

  it.each([
    ["image/jpeg"],
    ["image/webp"],
    ["image/gif"],
    ["image/bmp"],
    ["image/avif"],
    ["image/tiff"],
    ["image/x-icon"],
  ])("accepts allowed mime type %s", (mimeType) => {
    const result = parseImageDataUrl(
      `data:${mimeType};base64,${TINY_PNG_BASE64}`,
    );
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe(mimeType);
  });

  it("rejects SVG data URLs to prevent script execution", () => {
    expect(
      parseImageDataUrl(`data:image/svg+xml;base64,${TINY_PNG_BASE64}`),
    ).toBeNull();
  });

  it.each([
    ["text/html"],
    ["application/javascript"],
    ["application/octet-stream"],
    ["text/plain"],
  ])("rejects non-image mime type %s", (mimeType) => {
    expect(
      parseImageDataUrl(`data:${mimeType};base64,${TINY_PNG_BASE64}`),
    ).toBeNull();
  });

  it("rejects non-base64 data URLs", () => {
    expect(parseImageDataUrl("data:image/png,not-base64")).toBeNull();
  });

  it.each([
    ["empty string", ""],
    ["plain text", "hello world"],
    ["http URL", "https://example.com/image.png"],
    ["truncated data prefix", "data"],
    ["missing payload separator", "data:image/png;base64"],
    ["empty payload", "data:image/png;base64,"],
    ["bare prefix", "data:"],
  ])("rejects non-data-URL or malformed input: %s", (_label, value) => {
    expect(parseImageDataUrl(value)).toBeNull();
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

  it("tolerates long leading-whitespace prefixes", () => {
    const padding = " ".repeat(256);
    const result = parseImageDataUrl(
      `${padding}data:image/png;base64,${TINY_PNG_BASE64}`,
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

  it.each([[null], [undefined], [123], [{}]])(
    "handles non-string input safely: %p",
    (value) => {
      expect(parseImageDataUrl(value as unknown as string)).toBeNull();
    },
  );
});

describe("isAllowedImageMimeType", () => {
  it.each([["image/png"], ["IMAGE/JPEG"], ["image/webp"], ["image/gif"]])(
    "accepts %s",
    (mimeType) => {
      expect(isAllowedImageMimeType(mimeType)).toBe(true);
    },
  );

  it.each([
    ["image/svg+xml"],
    ["text/html"],
    ["application/javascript"],
    ["text/plain"],
  ])("rejects %s", (mimeType) => {
    expect(isAllowedImageMimeType(mimeType)).toBe(false);
  });
});

describe("buildImageDataUrl", () => {
  it("builds a data URL from parts", () => {
    expect(buildImageDataUrl("image/png", "abc")).toBe(
      "data:image/png;base64,abc",
    );
  });
});
