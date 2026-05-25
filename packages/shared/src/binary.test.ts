import { describe, expect, it } from "vitest";
import { BINARY_EXTENSIONS, isBinaryFile } from "./binary";

describe("isBinaryFile", () => {
  it.each([
    ["foo.png"],
    ["foo.JPG"],
    ["path/to/foo.gif"],
    ["foo.webp"],
    ["foo.tiff"],
    ["foo.avif"],
    ["foo.heic"],
    ["foo.svg"],
    ["foo.mp3"],
    ["foo.mp4"],
    ["foo.mov"],
    ["foo.pdf"],
    ["foo.zip"],
    ["foo.tar.gz"],
    ["foo.7z"],
    ["foo.exe"],
    ["foo.dll"],
    ["foo.dylib"],
    ["foo.wasm"],
    ["foo.ttf"],
    ["foo.woff2"],
  ])("returns true for %s", (filename) => {
    expect(isBinaryFile(filename)).toBe(true);
  });

  it.each([
    ["foo.txt"],
    ["foo.md"],
    ["foo.ts"],
    ["foo.json"],
    ["foo"],
    [""],
    ["README"],
  ])("returns false for %s", (filename) => {
    expect(isBinaryFile(filename)).toBe(false);
  });

  it("includes every canonical image extension", () => {
    for (const ext of [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "ico",
      "tiff",
      "tif",
      "svg",
      "heic",
      "heif",
      "avif",
    ]) {
      expect(BINARY_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});
