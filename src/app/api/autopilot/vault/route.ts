import { agentHttp } from "@/lib/autopilot/http";
export const runtime = "nodejs";
export const POST = (request: Request) => agentHttp(request, "vault");
