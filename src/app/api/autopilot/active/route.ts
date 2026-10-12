import { autopilotActiveResponse } from "@/lib/autopilot/protection-context";
export const runtime = "nodejs";
export const GET = () => autopilotActiveResponse();
