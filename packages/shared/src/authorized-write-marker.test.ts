import { describe, expect, it } from "vitest";
import {
  type AuthorizedWrite,
  buildAuthorizedWriteMarker,
  parseAuthorizedWriteMarkers,
} from "./authorized-write-marker";

describe("authorized-write markers", () => {
  const write: AuthorizedWrite = {
    subTool: "desktop-file-system-instructions-partial-update",
    id: "folder-abc-123",
  };

  it("round-trips a marker embedded in a larger prompt", () => {
    const prompt = `Build a CONTEXT.md.\n\n${buildAuthorizedWriteMarker(write)}`;
    expect(parseAuthorizedWriteMarkers(prompt)).toEqual([write]);
  });

  it("parses multiple markers in order", () => {
    const a: AuthorizedWrite = {
      subTool: "desktop-file-system-canvas-partial-update",
      id: "dash-1",
    };
    const b: AuthorizedWrite = {
      subTool: "desktop-file-system-instructions-partial-update",
      id: "folder-2",
    };
    const text = `${buildAuthorizedWriteMarker(a)} then ${buildAuthorizedWriteMarker(b)}`;
    expect(parseAuthorizedWriteMarkers(text)).toEqual([a, b]);
  });

  it("returns nothing when there is no marker", () => {
    expect(parseAuthorizedWriteMarkers("just a normal prompt")).toEqual([]);
    expect(parseAuthorizedWriteMarkers("")).toEqual([]);
  });

  it("ignores malformed markers (missing subtool or id)", () => {
    expect(
      parseAuthorizedWriteMarkers('<!-- posthog:authorized-write id="x" -->'),
    ).toEqual([]);
    expect(
      parseAuthorizedWriteMarkers(
        '<!-- posthog:authorized-write subtool="x" -->',
      ),
    ).toEqual([]);
    expect(
      parseAuthorizedWriteMarkers("<!-- posthog:authorized-write -->"),
    ).toEqual([]);
  });
});
