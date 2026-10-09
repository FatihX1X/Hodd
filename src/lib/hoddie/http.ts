import { z } from "zod";
import { HoddieError } from "./models";
export async function readBody(request: Request) {
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  if (!reader) throw new HoddieError("INVALID_INPUT", "The request failed validation.");
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new HoddieError("REQUEST_TOO_LARGE", "Keep the command or form shorter.", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const value = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(value) as unknown; } catch { throw new HoddieError("INVALID_INPUT", "The request failed validation."); }
}
export function errorResponse(error: unknown) {
  const known = error instanceof HoddieError;
  const message = known ? error.message : error instanceof z.ZodError ? "Check the amount, date and required form fields. Nothing was prepared." : "Hoddie could not complete this request. Check Activity before repeating a confirmation.";
  return Response.json({ status: "ERROR", code: known ? error.code : "UNAVAILABLE", message }, { status: known ? error.status : error instanceof z.ZodError ? 400 : 503, headers: { "Cache-Control": "no-store" } });
}
