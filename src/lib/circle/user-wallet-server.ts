import "server-only";

import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const UCW_TOKEN_COOKIE = "hodd_ucw_token";
export const UCW_ENCRYPTION_COOKIE = "hodd_ucw_encryption";
export const UCW_BINDING_COOKIE = "hodd_ucw_binding";

export function sessionBinding(userId: string, token: string) {
  const key = process.env.CIRCLE_API_KEY?.trim();
  if (!key) throw new Error("Circle is unavailable");
  return createHmac("sha256", key).update(`${userId}:${token}`).digest("hex");
}

export async function boundUserToken(userId: string) {
  const store = await cookies();
  const token = store.get(UCW_TOKEN_COOKIE)?.value;
  const binding = store.get(UCW_BINDING_COOKIE)?.value;
  if (!token || !binding || !process.env.CIRCLE_API_KEY) return null;
  const expected = sessionBinding(userId, token);
  return binding.length === expected.length && timingSafeEqual(Buffer.from(binding), Buffer.from(expected)) ? token : null;
}

export function isSameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function circleUserWalletClient() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) return null;
  return initiateUserControlledWalletsClient({ apiKey });
}

export function circleErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { response?: { data?: { code?: unknown } }; code?: unknown };
  const code = candidate.response?.data?.code ?? candidate.code;
  return typeof code === "number" ? code : typeof code === "string" && /^\d+$/.test(code) ? Number(code) : undefined;
}
