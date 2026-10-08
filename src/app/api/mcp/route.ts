import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyAgentToken } from "@/lib/agent/auth";
import { HODD_INSTRUCTIONS, registerHoddTools } from "@/lib/agent/tools";
import { publicOrigin, RESOURCE_METADATA_PATH } from "@/lib/agent/origin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Remote MCP endpoint for the Hodd Claude connector (Streamable HTTP, stateless).
// Every request needs a Supabase OAuth access token issued to a connector client;
// without one the response is 401 with a pointer to the protected-resource metadata.
const mcp = createMcpHandler((server) => registerHoddTools(server), {
  serverInfo: { name: "hodd", version: "0.1.0" },
  instructions: HODD_INSTRUCTIONS,
});

async function handler(request: Request) {
  return withMcpAuth(mcp, (_request, token) => verifyAgentToken(token), {
    required: true,
    resourceMetadataPath: RESOURCE_METADATA_PATH,
    resourceUrl: publicOrigin(request),
  })(request);
}

export { handler as GET, handler as POST, handler as DELETE };
