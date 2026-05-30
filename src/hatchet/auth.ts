export interface HatchetConfig {
  token: string;
  apiBase: string;
  tenantId: string;
}

export function decodeToken(token: string): { serverUrl: string; tenantId: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed Hatchet token: expected a 3-part JWT.");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed Hatchet token: payload is not valid JSON.");
  }
  return {
    serverUrl: typeof payload.server_url === "string" ? payload.server_url : "",
    tenantId: typeof payload.sub === "string" ? payload.sub : "",
  };
}

export function resolveConfig(env: Record<string, string | undefined>): HatchetConfig {
  const token = env.HATCHET_CLIENT_TOKEN;
  if (!token) {
    throw new Error(
      "HATCHET_CLIENT_TOKEN is required. Generate an API token in the Hatchet dashboard.",
    );
  }
  const claims = decodeToken(token);
  const apiBase = (env.HATCHET_API_BASE || claims.serverUrl).replace(/\/+$/, "");
  const tenantId = env.HATCHET_TENANT_ID || claims.tenantId;
  if (!apiBase) {
    throw new Error("Could not determine API base URL. Set HATCHET_API_BASE.");
  }
  if (!tenantId) {
    throw new Error("Could not determine tenant id from token. Set HATCHET_TENANT_ID.");
  }
  return { token, apiBase, tenantId };
}
