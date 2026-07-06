import { describe, expect, it } from "vitest";
import {
  buildCustomServerRequest,
  type CustomServerFormValues,
  canSubmitCustomServer,
  isValidMcpUrl,
} from "./customServerForm";

function values(
  overrides: Partial<CustomServerFormValues> = {},
): CustomServerFormValues {
  return {
    name: "My server",
    url: "https://mcp.example.com/stream",
    description: "A server",
    authType: "oauth",
    apiKey: "",
    clientId: "",
    clientSecret: "",
    username: "",
    password: "",
    ...overrides,
  };
}

describe("isValidMcpUrl", () => {
  it("accepts https and http urls", () => {
    expect(isValidMcpUrl("https://x.com/y")).toBe(true);
    expect(isValidMcpUrl("http://x.com/y")).toBe(true);
  });

  it("trims before validating", () => {
    expect(isValidMcpUrl("  https://x.com/y  ")).toBe(true);
  });

  it("rejects non-http schemes and bare hosts", () => {
    expect(isValidMcpUrl("ftp://x.com")).toBe(false);
    expect(isValidMcpUrl("x.com")).toBe(false);
    expect(isValidMcpUrl("")).toBe(false);
  });
});

describe("canSubmitCustomServer", () => {
  it("requires a non-empty name and a valid url", () => {
    expect(canSubmitCustomServer({ name: "X", url: "https://x.com" })).toBe(
      true,
    );
    expect(canSubmitCustomServer({ name: "  ", url: "https://x.com" })).toBe(
      false,
    );
    expect(canSubmitCustomServer({ name: "X", url: "nope" })).toBe(false);
  });

  it.each([
    ["both empty", "", "", true],
    ["both present", "user", "pass", true],
    ["username only", "user", "", false],
    ["password only", "", "pass", false],
  ])(
    "for basic auth with %s, returns %s",
    (_label, username, password, expected) => {
      expect(
        canSubmitCustomServer({
          name: "X",
          url: "https://x.com",
          authType: "basic",
          username,
          password,
        }),
      ).toBe(expected);
    },
  );

  it("ignores username/password pairing for non-basic auth types", () => {
    expect(
      canSubmitCustomServer({
        name: "X",
        url: "https://x.com",
        authType: "oauth",
        username: "user",
        password: "",
      }),
    ).toBe(true);
  });
});

describe("buildCustomServerRequest", () => {
  it("trims the base fields", () => {
    const req = buildCustomServerRequest(
      values({ name: "  N  ", url: "  https://x.com  ", description: "  d  " }),
    );
    expect(req.name).toBe("N");
    expect(req.url).toBe("https://x.com");
    expect(req.description).toBe("d");
  });

  it("includes api_key only for api_key auth when present", () => {
    expect(
      buildCustomServerRequest(values({ authType: "api_key", apiKey: "k" }))
        .api_key,
    ).toBe("k");
    expect(
      buildCustomServerRequest(values({ authType: "oauth", apiKey: "k" }))
        .api_key,
    ).toBeUndefined();
    expect(
      buildCustomServerRequest(values({ authType: "api_key", apiKey: "" }))
        .api_key,
    ).toBeUndefined();
  });

  it("includes client_id/client_secret only for oauth when non-empty", () => {
    const req = buildCustomServerRequest(
      values({ authType: "oauth", clientId: " cid ", clientSecret: " sec " }),
    );
    expect(req.client_id).toBe("cid");
    expect(req.client_secret).toBe("sec");

    const apiKeyReq = buildCustomServerRequest(
      values({ authType: "api_key", clientId: "cid", clientSecret: "sec" }),
    );
    expect(apiKeyReq.client_id).toBeUndefined();
    expect(apiKeyReq.client_secret).toBeUndefined();
  });

  it("includes username/password for basic auth when both are present", () => {
    const req = buildCustomServerRequest(
      values({ authType: "basic", username: " user ", password: "pass" }),
    );
    expect(req.username).toBe("user");
    expect(req.password).toBe("pass");
  });

  it.each([
    ["oauth", "user", "pass"],
    ["basic", "", "pass"],
    ["basic", "user", ""],
  ] as const)(
    "excludes username/password when authType is %s with username=%j password=%j",
    (authType, username, password) => {
      const req = buildCustomServerRequest(
        values({ authType, username, password }),
      );
      expect(req.username).toBeUndefined();
      expect(req.password).toBeUndefined();
    },
  );
});
