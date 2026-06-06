import { describe, expect, it } from "vitest";
import { OAUTH_SCOPE_VERSION, OAUTH_SCOPES } from "./oauth";

describe("OAUTH_SCOPES guard", () => {
  it("snapshot breaks when scopes change — bump OAUTH_SCOPE_VERSION if this fails", () => {
    expect({
      scopeVersion: OAUTH_SCOPE_VERSION,
      scopes: OAUTH_SCOPES,
    }).toMatchInlineSnapshot(`
      {
        "scopeVersion": 5,
        "scopes": [
          "*",
        ],
      }
    `);
  });
});
