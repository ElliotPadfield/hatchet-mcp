import { describe, it, expect } from "vitest";
import { decodeToken, resolveConfig } from "../src/hatchet/auth.js";

// JWT with payload {"server_url":"https://cloud.onhatchet.run","sub":"tenant-123"}
// header/sig are dummies — we only decode the payload, never verify the signature.
const PAYLOAD = Buffer.from(
  JSON.stringify({ server_url: "https://cloud.onhatchet.run", sub: "tenant-123" }),
).toString("base64url");
const TOKEN = `aaa.${PAYLOAD}.bbb`;

describe("decodeToken", () => {
  it("extracts server_url and sub", () => {
    expect(decodeToken(TOKEN)).toEqual({
      serverUrl: "https://cloud.onhatchet.run",
      tenantId: "tenant-123",
    });
  });

  it("throws on a malformed (non-3-part) token", () => {
    expect(() => decodeToken("not-a-jwt")).toThrow(/malformed/i);
  });
});

describe("resolveConfig", () => {
  it("derives base + tenant from the token", () => {
    expect(resolveConfig({ HATCHET_CLIENT_TOKEN: TOKEN })).toEqual({
      token: TOKEN,
      apiBase: "https://cloud.onhatchet.run",
      tenantId: "tenant-123",
    });
  });

  it("env overrides take precedence over token claims", () => {
    expect(
      resolveConfig({
        HATCHET_CLIENT_TOKEN: TOKEN,
        HATCHET_API_BASE: "https://self.hosted.example",
        HATCHET_TENANT_ID: "tenant-override",
      }),
    ).toEqual({
      token: TOKEN,
      apiBase: "https://self.hosted.example",
      tenantId: "tenant-override",
    });
  });

  it("throws a clear error when token is missing", () => {
    expect(() => resolveConfig({})).toThrow(/HATCHET_CLIENT_TOKEN/);
  });

  it("strips a trailing slash from apiBase", () => {
    expect(
      resolveConfig({ HATCHET_CLIENT_TOKEN: TOKEN, HATCHET_API_BASE: "https://x.example/" }).apiBase,
    ).toBe("https://x.example");
  });
});
