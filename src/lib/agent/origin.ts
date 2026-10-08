/**
 * Public origin the client used, behind Vercel's proxy (x-forwarded-*) or locally
 * (Host header; `next dev` reports request.url as localhost even for 127.0.0.1).
 * Claude requires the protected-resource `resource` to equal the MCP URL exactly.
 */
export function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const MCP_PATH = "/api/mcp";
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
