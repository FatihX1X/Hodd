import { agentHttp } from "@/lib/autopilot/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = (request: Request) => agentHttp(request, "run");
