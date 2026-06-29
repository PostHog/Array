import { describe, expect, it } from "vitest";
import {
  ALLOWED_VIDEO_MIME_TYPES,
  getVideoMimeType,
  isAllowedVideoMimeType,
  isPlayableVideoFile,
  VIDEO_MIME_TYPES,
} from "./video";

describe("isPlayableVideoFile", () => {
  it.each([
    ["clip.mp4"],
    ["clip.M4V"],
    ["path/to/demo.webm"],
    ["recording.mov"],
    ["loop.ogv"],
  ])("returns true for %s", (filename) => {
    expect(isPlayableVideoFile(filename)).toBe(true);
  });

  it.each([
    ["clip.avi"],
    ["clip.mkv"],
    ["clip.wmv"],
    ["clip.flv"],
    ["clip.mpg"],
    ["audio.mp3"],
    ["image.png"],
    ["notes.txt"],
    ["novideo"],
    [""],
  ])("returns false for %s", (filename) => {
    expect(isPlayableVideoFile(filename)).toBe(false);
  });
});

describe("getVideoMimeType", () => {
  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.m4v", "video/mp4"],
    ["clip.mov", "video/quicktime"],
    ["clip.webm", "video/webm"],
    ["clip.ogv", "video/ogg"],
  ])("maps %s to %s", (filename, mimeType) => {
    expect(getVideoMimeType(filename)).toBe(mimeType);
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(getVideoMimeType("clip.avi")).toBe("application/octet-stream");
  });
});

describe("isAllowedVideoMimeType", () => {
  it("accepts every mapped mime type", () => {
    for (const mimeType of Object.values(VIDEO_MIME_TYPES)) {
      expect(isAllowedVideoMimeType(mimeType)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isAllowedVideoMimeType("VIDEO/MP4")).toBe(true);
  });

  it("rejects mime types outside the allowed set", () => {
    expect(isAllowedVideoMimeType("video/x-msvideo")).toBe(false);
    expect(isAllowedVideoMimeType("application/octet-stream")).toBe(false);
  });

  it("keeps mapped mime types and the allow-list aligned", () => {
    for (const mimeType of Object.values(VIDEO_MIME_TYPES)) {
      expect(ALLOWED_VIDEO_MIME_TYPES.has(mimeType)).toBe(true);
    }
  });
});
