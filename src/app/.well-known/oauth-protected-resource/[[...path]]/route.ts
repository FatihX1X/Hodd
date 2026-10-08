import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { supabaseIssuer } from "@/lib/agent/auth";
import { MCP_PATH, publicOrigin } from "@/lib/agent/origin";

export const runtime = "nodejs";

// RFC 9728 metadata for the MCP endpoint. Served at both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp;
// `resource` is always the exact MCP URL and Supabase Auth is the authorization server.
export function GET(request: Request) {
  const issuer = supabaseIssuer();
  if (!issuer) return Response.json({ error: "not_configured" }, { status: 503 });
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [issuer],
    resourceUrl: `${publicOrigin(request)}${MCP_PATH}`,
    additionalMetadata: { resource_name: "Hodd Finance", scopes_supported: ["openid", "email", "profile"], bearer_methods_supported: ["header"] },
  });
  return Response.json(metadata, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=300" } });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
