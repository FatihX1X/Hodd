import { createHash } from "node:crypto";

/** Stable sha256 over JSON, used for session bindings and policy/call digests. */
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
