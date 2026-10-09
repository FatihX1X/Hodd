import type { ChatRequest, HoddieModelReply } from "./schema";

export type ServiceResult =
  | Readonly<{ status: "READY"; reply: HoddieModelReply }>
  | Readonly<{ status: "UNAVAILABLE"; reason: "SIGN_IN" | "OFFLINE" }>;

/** Asks Hoddie's language service. Any failure degrades to "unavailable" so the chat can fall back to basic mode. */
export async function askLanguageServiceFromBrowser(request: ChatRequest, fetcher: typeof fetch = fetch): Promise<ServiceResult> {
  try {
    const response = await fetcher("/api/hoddie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), cache: "no-store" });
    if (response.status === 401) return { status: "UNAVAILABLE", reason: "SIGN_IN" };
    if (!response.ok) return { status: "UNAVAILABLE", reason: "OFFLINE" };
    const body = await response.json() as { status?: string; reply?: HoddieModelReply };
    return body.status === "READY" && body.reply ? { status: "READY", reply: body.reply } : { status: "UNAVAILABLE", reason: "OFFLINE" };
  } catch { return { status: "UNAVAILABLE", reason: "OFFLINE" }; }
}
