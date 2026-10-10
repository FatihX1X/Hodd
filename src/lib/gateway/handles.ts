import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { handleSecret } from "@/lib/agent/handles";

// Stateless, signed handles for Gateway moves into the user's own wallet. They
// bind user, session binding, wallet and the exact intent; the server never
// trusts a value it did not seal.
const key = () => Buffer.from(hkdfSync("sha256", handleSecret(), "hodd", "hodd-gateway-move-v1", 32));

export function sealGatewayHandle(value: unknown) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}

export function openGatewayHandle<T>(value: string, schema: z.ZodType<T>): T | null {
  try {
    const [body, mac, extra] = value.split(".");
    if (!body || !mac || extra) return null;
    const expected = Buffer.from(createHmac("sha256", key()).update(body).digest("base64url")); const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const parsed = schema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
