import { describe, expect, it } from "vitest";
import { oAuthTokenResponse } from "./oauth.schemas";

describe("oAuthTokenResponse", () => {
  it("preserves project scopes from the token response", () => {
    const token = oAuthTokenResponse.parse({
      access_token: "access-token",
      expires_in: 3600,
      token_type: "Bearer",
      refresh_token: "refresh-token",
      scoped_teams: [42, 84],
      scoped_organizations: [],
    });

    expect(token.scoped_teams).toEqual([42, 84]);
  });
});
